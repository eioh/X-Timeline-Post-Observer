// ==UserScript==
// @name         X Timeline Post Observer
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  MutationObserverで新着ポストを監視し、フィルタリングする
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValues
// @grant        GM_setValues
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  /**
   * コンソール操作用 API を unsafeWindow へ公開する。
   * 入力: 公開したい関数群を持つオブジェクト
   * 出力: なし
   * 主な処理内容: Tampermonkey サンドボックス越しに window.XObserver を提供する
   */
  function exposeApi (api) {
    unsafeWindow.XObserver = api;
  }

  // DOM 上で「処理済み」と「非表示理由」を識別するための属性名。
  // CSS クラスではなく data 属性にしているのは、X 側のクラス変動と衝突しにくくするため。
  const PROCESSED_ATTR = 'data-xtlo-processed';
  const HIDDEN_ATTR = 'data-xtlo-hidden';

  // 非表示にした投稿を一定期間で自然消滅させるための期限設定。
  // 恒久データにすると、過去の一時的な非表示が残り続けて管理しづらくなる。
  const EXPIRE_DAYS = 30;
  const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;

  // 設定 JSON の互換性判定に使う形式バージョン。
  // 形式変更時は import 側の検証と必ずセットで更新する。
  const EXPORT_VERSION = 2;

  // Tampermonkey ストレージの保存キー一覧。
  // モジュール分割後もキー名を散らさず、互換性影響をここで追えるようにしている。
  const STORAGE_KEYS = {
    mediaFilterLists: 'xtlo_mediaFilterLists',
    hiddenUserIds: 'xtlo_hiddenUserIds',
    hiddenWords: 'xtlo_hiddenWords',
    hiddenStatuses: 'xtlo_hiddenStatuses',
    hideUIEnabled: 'xtlo_hideUIEnabled',
    autoRefreshEnabled: 'xtlo_autoRefreshEnabled'
  };

  // 新着自動読込の間隔と、トップ判定に使うスクロール閾値。
  // 厳密な 0px 判定だとわずかなズレで自動更新が止まりやすいため、少し余裕を持たせている。
  const AUTO_REFRESH_INTERVAL = 10 * 1000;
  const SCROLL_TOP_THRESHOLD = 50;

  // X のヘッダーや投稿フォームを隠して閲覧領域を広げるための CSS。
  const HIDE_UI_CSS = `
  header[role="banner"] {
    display: none !important;
  }
  div:has(> div[role="progressbar"]):has(> div [data-testid="tweetTextarea_0"]) {
    display: none !important;
  }
`;

  // タイムライン密度を上げるため、アバター列を圧縮する CSS。
  // レイアウト変更に弱い箇所なので、値は他ファイルへ分散させずここで管理する。
  const COMPACT_LAYOUT_CSS = `
  article div:has(> [data-testid="Tweet-User-Avatar"]) {
    flex-basis: 20px !important;
    margin-right: 4px !important;
  }

  article [data-testid="Tweet-User-Avatar"],
  article [data-testid="Tweet-User-Avatar"] div,
  article [data-testid="Tweet-User-Avatar"] a,
  article [data-testid="Tweet-User-Avatar"] img {
    width: 20px !important;
    height: 20px !important;
    min-width: 20px !important;
    min-height: 20px !important;
  }
`;

  // X 標準メニューに差し込む独自メニュー項目の見た目。
  // 注入先は X 側 DOM に依存するため、少なくともクラス名と構造の対応関係が追えるように定数化している。
  const CUSTOM_MENU_CSS = `
  .xtlo-hide-post-menuitem {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .xtlo-hide-post-menuitem:hover {
    background-color: rgba(239, 243, 244, 0.1);
  }
  .xtlo-hide-post-menuitem .xtlo-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    width: 18.75px;
    height: 18.75px;
  }
  .xtlo-hide-post-menuitem .xtlo-icon svg {
    fill: rgb(239, 243, 244);
    width: 18.75px;
    height: 18.75px;
  }
  .xtlo-hide-post-menuitem .xtlo-label {
    color: rgb(239, 243, 244);
    font-family: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 20px;
    font-weight: 400;
  }
`;

  /**
   * タイムラインの DOM 変化を監視して再処理をつなぐ。
   * 入力: scheduleProcess と handleLateMedia を持つオブジェクト
   * 出力: MutationObserver
   * 主な処理内容:
   * 1. 新しい article 追加を検知する
   * 2. 処理済み article 内の遅延メディア追加を検知する
   * 3. 必要な再処理だけを呼び出す
   */
  function setupTimelineObserver ({ scheduleProcess, handleLateMedia }) {
    const observer = new MutationObserver(mutations => {
      let hasNewArticle = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue

          // article 追加は直接ノードだけでなく、追加 subtree 内にも現れるため querySelector で拾う。
          if (node.querySelector && node.querySelector('article')) {
            hasNewArticle = true;
          }

          // 画像・動画は article 本体より遅れて差し込まれるため、メディア要素追加も独立に拾う。
          const mediaNodes = [];
          if (
            node.getAttribute &&
            (node.getAttribute('data-testid') === 'tweetPhoto' ||
              node.getAttribute('data-testid') === 'videoPlayer' ||
              node.getAttribute('data-testid') === 'videoComponent')
          ) {
            mediaNodes.push(node);
          }
          if (node.querySelectorAll) {
            mediaNodes.push(
              ...node.querySelectorAll(
                '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
              )
            );
          }

          for (const media of mediaNodes) {
            const article = media.closest('article');
            if (article && article.hasAttribute(PROCESSED_ATTR)) {
              handleLateMedia(article);
            }
          }
        }
      }

      if (hasNewArticle) {
        scheduleProcess();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return observer
  }

  /**
   * 現在アクティブなタイムラインタブ名を返す。
   * 入力: なし
   * 出力: タブ名文字列。取得できない場合は null
   * 主な処理内容: role 属性と aria-selected を使って X のタブ選択状態を読む
   */
  function getActiveTabName () {
    const activeTab = document.querySelector(
      '[role="tablist"] [role="tab"][aria-selected="true"]'
    );
    return activeTab ? activeTab.textContent.trim() : null
  }

  /**
   * 引用カードの React Fiber から引用先 statusId を探す。
   * 入力: 引用カード相当の DOM 要素
   * 出力: 引用先 statusId。取れない場合は null
   * 主な処理内容: Fiber を親方向へたどり、link.pathname から /status/<数字> を抜き出す
   */
  function getQuoteStatusIdFromFiber (quoteDivElement) {
    const fiberKey = Object.keys(quoteDivElement).find(key =>
      key.startsWith('__reactFiber$')
    );
    if (!fiberKey) return null

    let fiber = quoteDivElement[fiberKey];
    for (let i = 0; i < 15 && fiber; i++) {
      const props = fiber.memoizedProps || {};
      if (props.link && typeof props.link === 'object' && props.link.pathname) {
        const match = props.link.pathname.match(/\/status\/(\d+)/);
        if (match) return match[1]
      }
      fiber = fiber.return;
    }

    return null
  }

  /**
   * DOM 内リンクから引用先 statusId を探す。
   * 入力: 元 article 要素、引用ユーザー ID
   * 出力: 引用先 statusId。取れない場合は null
   * 主な処理内容: 該当ユーザーの /status/ リンクを総当たりで探す
   */
  function getQuoteStatusIdFromDOM (article, quoteUserId) {
    if (!quoteUserId) return null

    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href.includes('/' + quoteUserId + '/status/')) {
        const match = href.match(/\/status\/(\d+)/);
        if (match) return match[1]
      }
    }

    return null
  }

  /**
   * tweetText 要素から、画面表示に近い本文文字列を再構築する。
   * 入力: tweetText 要素
   * 出力: 復元した本文文字列
   * 主な処理内容:
   * 1. TextNode をそのまま連結する
   * 2. 絵文字画像は alt 属性で復元する
   * 3. 外部URLは title 属性を優先して展開先 URL を採用する
   */
  function getFullVisibleText (element) {
    let text = '';

    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IMG') {
          text += node.getAttribute('alt') || '';
        } else if (node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          const title = node.getAttribute('title');
          if (title && href.startsWith('http')) {
            // t.co 短縮リンクをそのまま判定するとワードフィルタが外れるため、展開先URLを採用する。
            text += title;
          } else {
            text += getFullVisibleText(node);
          }
        } else {
          text += getFullVisibleText(node);
        }
      }
    }

    return text
  }

  /**
   * 引用投稿部分の情報を抽出する。
   * 入力: 親 article 要素、引用カード要素
   * 出力: 引用投稿の userId / statusId / 本文 / メディア有無
   * 主な処理内容: 引用カード内の本文・アバター・メディアと、引用先 ID をまとめて読む
   */
  function extractQuoteInfo (article, quoteDivElement) {
    const avatarEl = quoteDivElement.querySelector(
      '[data-testid^="UserAvatar-Container-"]'
    );
    const userId = avatarEl
      ? avatarEl.getAttribute('data-testid').replace('UserAvatar-Container-', '')
      : null;

    const tweetTextEl = quoteDivElement.querySelector('[data-testid="tweetText"]');
    const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : '';

    const hasImages =
      quoteDivElement.querySelectorAll('[data-testid="tweetPhoto"]').length > 0;
    const hasVideos =
      quoteDivElement.querySelectorAll(
        '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
      ).length > 0;

    const statusId =
      getQuoteStatusIdFromFiber(quoteDivElement) ||
      getQuoteStatusIdFromDOM(article, userId);

    return {
      statusId: statusId || null,
      userId,
      text,
      hasImages,
      hasVideos,
      hasMedia: hasImages || hasVideos
    }
  }

  /**
   * リポスト文脈の有無と、リポストしたユーザー ID を抽出する。
   * 入力: 親 article 要素
   * 出力: isRepost と repostedBy を持つオブジェクト
   * 主な処理内容: socialContext の親リンクから /<screen_name> 形式のプロフィールパスだけを採用する
   */
  function extractRepostInfo (article) {
    const socialContextEl = article.querySelector('[data-testid="socialContext"]');
    if (!socialContextEl) {
      return {
        isRepost: false,
        repostedBy: null
      }
    }

    const repostLink = socialContextEl.closest('a[href^="/"]');
    if (!repostLink) {
      return {
        isRepost: true,
        repostedBy: null
      }
    }

    const href = repostLink.getAttribute('href') || '';
    // socialContext 近傍には投稿詳細リンクもあり得るため、プロフィール直下のパスだけを採用する。
    const match = href.match(/^\/([^/?#]+)$/);

    return {
      isRepost: true,
      repostedBy: match ? match[1] : null
    }
  }

  /**
   * タイムライン上の article から投稿情報を抽出する。
   * 入力: article 要素
   * 出力: statusId / userId / 本文 / リポスト情報 / メディア有無 / 引用情報を含むオブジェクト
   * 主な処理内容:
   * 1. 投稿 ID とユーザー ID を取る
   * 2. 本文を見た目に近い形で復元する
   * 3. socialContext からリポスト情報を取る
   * 4. 引用投稿内メディアを差し引いたうえで自前メディアを判定する
   */
  function extractPostInfo (article) {
    const statusLink = article.querySelector('a[href*="/status/"]');
    let statusId = null;
    if (statusLink) {
      const match = statusLink.getAttribute('href').match(/\/status\/(\d+)/);
      if (match) statusId = match[1];
    }

    const avatarEl = article.querySelector('[data-testid^="UserAvatar-Container-"]');
    const userId = avatarEl
      ? avatarEl.getAttribute('data-testid').replace('UserAvatar-Container-', '')
      : null;

    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
    const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : '';
    const { isRepost, repostedBy } = extractRepostInfo(article);

    const quoteDivElement = article.querySelector('div[role="link"][tabindex="0"]');
    const totalPhotos = article.querySelectorAll('[data-testid="tweetPhoto"]').length;
    const totalVideos = article.querySelectorAll(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
    ).length;

    let quotePhotos = 0;
    let quoteVideos = 0;
    if (quoteDivElement) {
      quotePhotos = quoteDivElement.querySelectorAll('[data-testid="tweetPhoto"]').length;
      quoteVideos = quoteDivElement.querySelectorAll(
        '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
      ).length;
    }

    // 引用ポスト内メディアを差し引かないと、本文だけの引用投稿までメディア付き扱いになる。
    const hasImages = totalPhotos - quotePhotos > 0;
    const hasVideos = totalVideos - quoteVideos > 0;
    const quote = quoteDivElement ? extractQuoteInfo(article, quoteDivElement) : null;

    return {
      statusId,
      userId,
      text,
      isRepost,
      repostedBy,
      hasImages,
      hasVideos,
      hasMedia: hasImages || hasVideos,
      quote
    }
  }

  /**
   * 大文字小文字を無視して部分一致比較できる文字列へ正規化する。
   * 入力: 比較対象の文字列
   * 出力: 小文字化した文字列
   * 主な処理内容: 登録値の見た目は保持したまま、判定時だけ比較条件を揃える
   */
  function normalizeTextForCaseInsensitiveMatch (text) {
    return text.toLowerCase()
  }

  /**
   * 投稿情報と現在設定から、非表示にすべき理由を返す。
   * 入力: タブ名、抽出済み投稿情報、現在設定
   * 出力: 非表示理由の文字列。表示対象なら null
   * 主な処理内容: メディアフィルタ、ユーザー、投稿 ID、キーワードの順で判定する
   */
  function shouldHide (tabName, postInfo, config) {
    // リスト単位のメディアフィルタは「表示条件」であり、他の非表示条件より先に判定すると意図が追いやすい。
    if (
      tabName &&
      config.mediaFilterLists.includes(tabName) &&
      !postInfo.hasMedia
    ) {
      return `media-filter (list: ${tabName})`
    }

    if (postInfo.userId && config.hiddenUserIds.includes(postInfo.userId)) {
      return `hidden-user (@${postInfo.userId})`
    }

    if (
      postInfo.statusId &&
      config.hiddenStatuses.some(entry => entry.statusId === postInfo.statusId)
    ) {
      return `hidden-status (${postInfo.statusId})`
    }

    if (postInfo.text) {
      // 登録時の表記をそのまま残したいので、保存値は変えずに比較時だけ小文字へ揃える。
      const normalizedPostText = normalizeTextForCaseInsensitiveMatch(postInfo.text);

      for (const word of config.hiddenWords) {
        if (normalizedPostText.includes(normalizeTextForCaseInsensitiveMatch(word))) {
          return `hidden-word ("${word}")`
        }
      }
    }

    return null
  }

  // 現在の設定を一か所に集約して持つ。
  // オブジェクト自体を差し替えると参照先が古いまま残るため、各モジュールはこの中身を書き換える前提で共有する。
  const config = {
    mediaFilterLists: [],
    hiddenUserIds: [],
    hiddenWords: [],
    hiddenStatuses: [],
    hideUIEnabled: true,
    autoRefreshEnabled: true
  };

  /**
   * 設定オブジェクトの中身を丸ごと新しい値へ更新する。
   * 入力: 次に反映したい設定オブジェクト。
   * 出力: なし。
   * 主な処理内容:
   * 1. 共有中の config オブジェクトへ配列と真偽値を上書きする
   * 2. 参照を保ったまま他モジュールへ最新設定を行き渡らせる
   */
  function assignConfig (nextConfig) {
    config.mediaFilterLists = nextConfig.mediaFilterLists;
    config.hiddenUserIds = nextConfig.hiddenUserIds;
    config.hiddenWords = nextConfig.hiddenWords;
    config.hiddenStatuses = nextConfig.hiddenStatuses;
    config.hideUIEnabled = nextConfig.hideUIEnabled;
    config.autoRefreshEnabled = nextConfig.autoRefreshEnabled;
  }

  /**
   * Tampermonkey ストレージから設定を読み込み、期限切れの投稿 ID も掃除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 各設定キーを既定値つきで読み込む
   * 2. 共通の config へ反映する
   * 3. hiddenStatuses から期限切れデータを除外して必要なら保存し直す
   */
  async function loadConfig () {
    const stored = await GM_getValues({
      [STORAGE_KEYS.mediaFilterLists]: [],
      [STORAGE_KEYS.hiddenUserIds]: [],
      [STORAGE_KEYS.hiddenWords]: [],
      [STORAGE_KEYS.hiddenStatuses]: [],
      [STORAGE_KEYS.hideUIEnabled]: true,
      [STORAGE_KEYS.autoRefreshEnabled]: true
    });

    assignConfig({
      mediaFilterLists: stored[STORAGE_KEYS.mediaFilterLists],
      hiddenUserIds: stored[STORAGE_KEYS.hiddenUserIds],
      hiddenWords: stored[STORAGE_KEYS.hiddenWords],
      hiddenStatuses: stored[STORAGE_KEYS.hiddenStatuses],
      hideUIEnabled: stored[STORAGE_KEYS.hideUIEnabled],
      autoRefreshEnabled: stored[STORAGE_KEYS.autoRefreshEnabled]
    });

    // 起動時に期限切れ投稿を取り除いておくと、古い一時非表示が残留せず再適用時の判定も単純に保てる。
    const now = Date.now();
    const before = config.hiddenStatuses.length;
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.expiresAt > now
    );

    if (config.hiddenStatuses.length !== before) {
      await saveKey('hiddenStatuses');
      console.log(
        `[X-Observer] 期限切れの非表示ポストを ${
        before - config.hiddenStatuses.length
      } 件削除しました`
      );
    }
  }

  /**
   * 指定キーに対応する設定だけを保存する。
   * 入力: config オブジェクト上のキー名。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. STORAGE_KEYS から対応する保存キーを引く
   * 2. Tampermonkey ストレージへその項目だけ書き込む
   */
  async function saveKey (configKey) {
    const storageKey = STORAGE_KEYS[configKey];
    await GM_setValues({ [storageKey]: config[configKey] });
  }

  /**
   * 新しい設定一式をメモリとストレージへまとめて反映する。
   * 入力: 完全な設定オブジェクト。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. config へ全項目を上書きする
   * 2. 永続化対象の全キーをまとめて保存する
   */
  async function replaceConfig (nextConfig) {
    assignConfig({
      mediaFilterLists: nextConfig.mediaFilterLists,
      hiddenUserIds: nextConfig.hiddenUserIds,
      hiddenWords: nextConfig.hiddenWords,
      hiddenStatuses: nextConfig.hiddenStatuses,
      hideUIEnabled: nextConfig.hideUIEnabled,
      autoRefreshEnabled: nextConfig.autoRefreshEnabled
    });

    await GM_setValues({
      [STORAGE_KEYS.mediaFilterLists]: config.mediaFilterLists,
      [STORAGE_KEYS.hiddenUserIds]: config.hiddenUserIds,
      [STORAGE_KEYS.hiddenWords]: config.hiddenWords,
      [STORAGE_KEYS.hiddenStatuses]: config.hiddenStatuses,
      [STORAGE_KEYS.hideUIEnabled]: config.hideUIEnabled,
      [STORAGE_KEYS.autoRefreshEnabled]: config.autoRefreshEnabled
    });
  }

  /** メディアフィルタ対象リストを追加する。*/
  async function addMediaFilterList (listName) {
    if (!config.mediaFilterLists.includes(listName)) {
      config.mediaFilterLists.push(listName);
      await saveKey('mediaFilterLists');
      console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`);
    }
  }

  /** メディアフィルタ対象リストを削除する。*/
  async function removeMediaFilterList (listName) {
    config.mediaFilterLists = config.mediaFilterLists.filter(n => n !== listName);
    await saveKey('mediaFilterLists');
    console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`);
  }

  /**
   * 非表示ユーザーを追加する。
   * 入力: @ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 保存時の表記ゆれを防ぐため先頭の @ を除去する
   * 2. 重複しない場合だけ設定へ追加して保存する
   */
  async function addHiddenUser (userId) {
    const id = userId.replace(/^@/, '');
    if (!config.hiddenUserIds.includes(id)) {
      config.hiddenUserIds.push(id);
      await saveKey('hiddenUserIds');
      console.log(`[X-Observer] 非表示ユーザー追加: @${id}`);
    }
  }

  /** 非表示ユーザーを削除する。*/
  async function removeHiddenUser (userId) {
    const id = userId.replace(/^@/, '');
    config.hiddenUserIds = config.hiddenUserIds.filter(user => user !== id);
    await saveKey('hiddenUserIds');
    console.log(`[X-Observer] 非表示ユーザー削除: @${id}`);
  }

  /**
   * 非表示キーワードを追加する。
   * 入力: 追加したいキーワード文字列。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 大文字小文字違いの重複を防ぐため比較用に小文字化する
   * 2. 実際の表示値は元の文字列を保持したまま保存する
   */
  async function addHiddenWord (word) {
    // 比較だけを小文字化するのは、画面表示やエクスポート時に入力どおりの文字列を残すため。
    const normalizedWord = word.toLowerCase();

    if (!config.hiddenWords.some(item => item.toLowerCase() === normalizedWord)) {
      config.hiddenWords.push(word);
      await saveKey('hiddenWords');
      console.log(`[X-Observer] 非表示ワード追加: "${word}"`);
    }
  }

  /** 非表示キーワードを削除する。*/
  async function removeHiddenWord (word) {
    config.hiddenWords = config.hiddenWords.filter(item => item !== word);
    await saveKey('hiddenWords');
    console.log(`[X-Observer] 非表示ワード削除: "${word}"`);
  }

  /**
   * 非表示ポストを期限付きで追加する。
   * 入力: 数字文字列の statusId。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 重複登録を避ける
   * 2. 期限つきデータとして expiresAt を付けて保存する
   */
  async function addHiddenStatus (statusId) {
    if (!config.hiddenStatuses.some(entry => entry.statusId === statusId)) {
      config.hiddenStatuses.push({
        statusId,
        expiresAt: Date.now() + EXPIRE_MS
      });
      await saveKey('hiddenStatuses');
      console.log(`[X-Observer] 非表示ポスト追加: ${statusId}`);
    }
  }

  /** 非表示ポストを削除する。*/
  async function removeHiddenStatus (statusId) {
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.statusId !== statusId
    );
    await saveKey('hiddenStatuses');
    console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`);
  }

  /** 現在の設定をログへ表示する。*/
  function showConfig () {
    console.log('[X-Observer] 現在の設定:', JSON.parse(JSON.stringify(config)));
  }

  /**
   * UI 非表示設定を更新して保存する。
   * 入力: 非表示を有効にするかどうかの真偽値。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 真偽値へ正規化して config に反映する
   * 2. Tampermonkey ストレージへ保存する
   */
  async function setHideUIEnabled (enabled) {
    config.hideUIEnabled = Boolean(enabled);
    await saveKey('hideUIEnabled');
  }

  /**
   * 自動更新設定を更新して保存する。
   * 入力: 自動更新を有効にするかどうかの真偽値。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 真偽値へ正規化して config に反映する
   * 2. Tampermonkey ストレージへ保存する
   */
  async function setAutoRefreshEnabled (enabled) {
    config.autoRefreshEnabled = Boolean(enabled);
    await saveKey('autoRefreshEnabled');
  }

  /**
   * 仮想スクロール用セルを article から逆引きする。
   * 入力: article 要素
   * 出力: position:absolute の祖先要素。見つからない場合は null
   * 主な処理内容: 親を数段さかのぼり、X の仮想リストセルを見つける
   */
  function getCellDiv (article) {
    let element = article;

    for (let i = 0; i < 6; i++) {
      element = element.parentElement;
      if (!element) return null
      if (element.style && element.style.position === 'absolute') return element
    }

    return null
  }

  /**
   * 投稿セルごと非表示にする。
   * 入力: article 要素、非表示理由
   * 出力: なし
   * 主な処理内容: 仮想スクロールの空白を防ぐため、article ではなく祖先セルを隠す
   */
  function hideArticle (article, reason) {
    const cellDiv = getCellDiv(article);
    if (cellDiv) {
      cellDiv.style.display = 'none';
    }
    article.setAttribute(HIDDEN_ATTR, reason);
  }

  /**
   * 非表示にしていた投稿セルを再表示する。
   * 入力: article 要素
   * 出力: なし
   * 主な処理内容: 祖先セルの display と data 属性を元に戻す
   */
  function unhideArticle (article) {
    const cellDiv = getCellDiv(article);
    if (cellDiv) {
      cellDiv.style.display = '';
    }
    article.removeAttribute(HIDDEN_ATTR);
  }

  /**
   * タイムライン処理本体をまとめたオブジェクトを生成する。
   * 入力: なし
   * 出力: 新規投稿処理、再判定、再適用、スケジュール実行の各関数
   * 主な処理内容: requestAnimationFrame の保留状態も含めて、投稿処理の状態を閉じ込める
   */
  function createProcessor () {
    let pendingRAF = false;

    /**
     * 未処理 article を走査して初回判定を行う。
     * 入力: なし
     * 出力: なし
     * 主な処理内容: 未処理 article に印を付け、情報抽出後に非表示判定を行う
     */
    function processNewArticles () {
      const articles = document.querySelectorAll(`article:not([${PROCESSED_ATTR}])`);
      if (articles.length === 0) return

      const tabName = getActiveTabName();

      articles.forEach(article => {
        article.setAttribute(PROCESSED_ATTR, 'true');

        const info = extractPostInfo(article);
        if (!info.statusId) return

        console.log('[X-Observer]', { tab: tabName, ...info });

        const hideReason = shouldHide(tabName, info, config);
        if (hideReason) {
          hideArticle(article, hideReason);
          console.log(`[X-Observer] 非表示: ${hideReason}`, info.statusId);
        }
      });
    }

    /**
     * 遅れて読み込まれたメディアを踏まえて再判定する。
     * 入力: 既に処理済みの article 要素
     * 出力: なし
     * 主な処理内容: メディア有無が後から変わるケースに限定して表示状態を更新する
     */
    function handleLateMedia (article) {
      const tabName = getActiveTabName();
      const info = extractPostInfo(article);
      if (!info.statusId) return

      console.log('[X-Observer] メディア遅延検出、再判定:', {
        tab: tabName,
        ...info
      });

      const hideReason = shouldHide(tabName, info, config);
      const currentlyHidden = article.hasAttribute(HIDDEN_ATTR);

      if (hideReason && !currentlyHidden) {
        hideArticle(article, hideReason);
      } else if (!hideReason && currentlyHidden) {
        unhideArticle(article);
      }
    }

    /**
     * 既に表示済みの投稿すべてへ現在設定を再適用する。
     * 入力: なし
     * 出力: なし
     * 主な処理内容: 設定変更後に hidden / shown の差分だけを反映する
     */
    function reapplyFilters () {
      const tabName = getActiveTabName();
      const articles = document.querySelectorAll(`article[${PROCESSED_ATTR}]`);
      let hiddenCount = 0;
      let shownCount = 0;

      articles.forEach(article => {
        const info = extractPostInfo(article);
        if (!info.statusId) return

        const hideReason = shouldHide(tabName, info, config);
        const currentlyHidden = article.hasAttribute(HIDDEN_ATTR);

        if (hideReason && !currentlyHidden) {
          hideArticle(article, hideReason);
          hiddenCount++;
        } else if (!hideReason && currentlyHidden) {
          unhideArticle(article);
          shownCount++;
        }
      });

      console.log(
        `[X-Observer] フィルタ再適用: ${hiddenCount} 件非表示, ${shownCount} 件再表示`
      );
    }

    /**
     * 新規投稿処理を次の描画タイミングへまとめて予約する。
     * 入力: なし
     * 出力: なし
     * 主な処理内容: MutationObserver 多発時の重複実行を pendingRAF で抑制する
     */
    function scheduleProcess () {
      if (pendingRAF) return
      pendingRAF = true;
      requestAnimationFrame(() => {
        pendingRAF = false;
        processNewArticles();
      });
    }

    return {
      processNewArticles,
      handleLateMedia,
      reapplyFilters,
      scheduleProcess
    }
  }

  /**
   * 新着ポスト自動更新の制御オブジェクトを作る。
   * 入力: なし。
   * 出力: start / stop / toggle / applyEnabledState / isEnabled を持つオブジェクト。
   * 主な処理内容:
   * 1. interval の開始と停止を管理する
   * 2. タイムライン上部にいるときだけ新着ボタンを押す
   * 3. 外部から保存済み設定を反映できる API を提供する
   */
  function createAutoRefreshController () {
    let autoRefreshEnabled = true;
    let autoRefreshTimer = null;

    /** 「新しいポストを表示」ボタンが表示中かどうかを判定する。*/
    function isNewPostButtonVisible () {
      const statusEl = document.querySelector('[role="status"]');
      if (!statusEl) return false

      const button = statusEl.querySelector('button');
      return Boolean(button && button.offsetHeight > 0)
    }

    /** スクロール位置がタイムライン最上部付近かどうかを判定する。*/
    function isNearTop () {
      return window.scrollY <= SCROLL_TOP_THRESHOLD
    }

    /**
     * 条件を満たす場合だけ新着ボタンを押す。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 設定が OFF なら何もしない
     * 2. 最上部かつ新着ボタン表示中ならクリックする
     */
    function checkAndAutoRefresh () {
      if (!autoRefreshEnabled) return

      if (isNearTop() && isNewPostButtonVisible()) {
        const button = document.querySelector('[role="status"] button');
        if (button) {
          button.click();
          console.log('[X-Observer] 新着ポストを自動更新しました');
        }
      }
    }

    /** interval を開始して自動更新を有効化する。*/
    function startAutoRefresh () {
      if (autoRefreshTimer) return
      autoRefreshTimer = setInterval(checkAndAutoRefresh, AUTO_REFRESH_INTERVAL);
      autoRefreshEnabled = true;
      console.log('[X-Observer] 自動更新: ON');
    }

    /** interval を停止して自動更新を無効化する。*/
    function stopAutoRefresh () {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      autoRefreshEnabled = false;
      console.log('[X-Observer] 自動更新: OFF');
    }

    /** 現在の状態を反転して自動更新を切り替える。*/
    function toggleAutoRefresh () {
      if (autoRefreshEnabled) {
        stopAutoRefresh();
      } else {
        startAutoRefresh();
      }
    }

    /**
     * 保存済み設定の真偽値をそのまま自動更新状態へ反映する。
     * 入力: 有効にするかどうかの真偽値。
     * 出力: なし。
     * 主な処理内容:
     * 1. true なら interval を開始する
     * 2. false なら interval を停止する
     */
    function applyEnabledState (enabled) {
      if (enabled) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    }

    /** 現在の自動更新状態を返す。*/
    function isEnabled () {
      return autoRefreshEnabled
    }

    return {
      startAutoRefresh,
      stopAutoRefresh,
      toggleAutoRefresh,
      applyEnabledState,
      isEnabled
    }
  }

  /**
   * X 標準ドロップダウンを React の onDismiss 経由で閉じる。
   * 入力: role="menu" の要素
   * 出力: なし
   * 主な処理内容: role="group" から React Fiber をたどり、onDismiss を呼び出す
   */
  function closeDropdownMenu (menu) {
    const groupEl = menu.closest('[role="group"]');
    if (!groupEl) return

    const fiberKey = Object.keys(groupEl).find(key =>
      key.startsWith('__reactFiber$')
    );
    if (!fiberKey) return

    let fiber = groupEl[fiberKey];
    for (let i = 0; i < 15 && fiber; i++) {
      const props = fiber.memoizedProps || {};
      if (typeof props.onDismiss === 'function') {
        props.onDismiss();
        return
      }
      fiber = fiber.return;
    }
  }

  /**
   * X 標準メニューへ差し込む独自 menuitem 要素を組み立てる。
   * 入力: 一意なクラス名、表示ラベル、クリック時の処理
   * 出力: role="menuitem" を持つ div 要素
   * 主な処理内容: X 標準メニューへなじむ共通 DOM 構造とイベント処理をまとめる
   */
  function createDropdownMenuItem ({ className, label, onSelect }) {
    const menuItem = document.createElement('div');
    menuItem.setAttribute('role', 'menuitem');
    menuItem.setAttribute('tabindex', '0');
    menuItem.className = className;
    menuItem.innerHTML = `
    <div class="xtlo-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <g>
          <path d="M3.693 21.707l-1.414-1.414 2.429-2.429c-2.479-2.421-3.606-5.376-3.658-5.513l-.131-.352.131-.352c.133-.353 3.331-8.648 10.937-8.648 2.062 0 3.834.629 5.332 1.644l2.674-2.674 1.414 1.414L3.693 21.707zm-.622-9.706c.356.797 1.354 2.794 3.051 4.449l2.417-2.418c-.361-.609-.553-1.306-.553-2.032 0-2.206 1.794-4 4-4 .727 0 1.424.192 2.033.554l2.263-2.264C14.953 5.434 13.512 5 11.986 5c-5.416 0-8.258 5.535-8.915 7.001zM11.986 10c-1.103 0-2 .897-2 2 0 .441.144.861.41 1.207l2.798-2.797C12.847 10.144 12.427 10 11.986 10zm9.878 7.06l-1.5-1.5c1.094-1.222 1.858-2.534 2.264-3.56-.869-1.907-3.813-7.001-8.642-7.001-.796 0-1.542.124-2.238.332l-1.63-1.63C11.064 3.241 12.136 3 13.271 3c6.256 0 9.573 6.971 9.778 7.432l.151.354-.108.341c-.148.465-1.065 2.893-2.928 4.933z"></path>
        </g>
      </svg>
    </div>
    <div class="xtlo-label">${label}</div>
  `;

    menuItem.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      await onSelect(menuItem);
    });

    return menuItem
  }

  /**
   * 投稿の「...」メニューへ独自の非表示項目を注入する監視を開始する。
   * 入力: 投稿・ユーザーの非表示登録関数と再適用関数
   * 出力: MutationObserver
   * 主な処理内容:
   * 1. 直前に押された caret を記録する
   * 2. menu 出現を監視する
   * 3. 対象投稿の statusId / userId を使って独自 menuitem を注入する
   */
  function setupDropdownHideMenu ({
    addHiddenStatus,
    addHiddenUser,
    reapplyFilters
  }) {
    // X 標準メニューは「どの投稿から開いたか」を直接渡してこないため、直前クリックを手掛かりにする。
    let lastClickedCaret = null;

    document.addEventListener(
      'click',
      event => {
        const caretButton = event.target.closest('[data-testid="caret"]');
        if (caretButton) {
          lastClickedCaret = caretButton;
        }
      },
      true
    );

    /**
     * 対象 menu へ「このポストを非表示」「このユーザーを非表示」項目を差し込む。
     * 入力: role="menu" の要素
     * 出力: なし
     * 主な処理内容: 直前 caret に対応する article を見つけ、投稿 ID とユーザー ID ごとの項目を追加する
     */
    function injectHideMenuItem (menu) {
      if (
        menu.querySelector('.xtlo-hide-post-menuitem') ||
        menu.querySelector('.xtlo-hide-user-menuitem')
      ) {
        return
      }
      if (!lastClickedCaret) return

      const article = lastClickedCaret.closest('article');
      if (!article) return

      const info = extractPostInfo(article);
      if (!info.statusId && !info.userId) return

      if (info.userId) {
        menu.appendChild(
          createDropdownMenuItem({
            className: 'xtlo-hide-user-menuitem xtlo-hide-post-menuitem',
            label: `ユーザーを非表示 (@${info.userId})`,
            onSelect: async menuItem => {
              const dropdownMenu = menuItem.closest('[role="menu"]');

              await addHiddenUser(info.userId);
              reapplyFilters();

              if (dropdownMenu) {
                // ユーザー追加後も X 標準メニューの閉じ方を揃え、開閉状態の不整合を避ける。
                closeDropdownMenu(dropdownMenu);
              }

              console.log(
                `[X-Observer] メニューからユーザーを非表示にしました: @${info.userId}`
              );
            }
          })
        );
      }

      if (info.statusId) {
        menu.appendChild(
          createDropdownMenuItem({
            className: 'xtlo-hide-post-menuitem',
            label: 'ポストを非表示',
            onSelect: async menuItem => {
              const dropdownMenu = menuItem.closest('[role="menu"]');

              await addHiddenStatus(info.statusId);
              reapplyFilters();

              if (dropdownMenu) {
                // X 側のメニュー管理状態を壊さず閉じるため、DOM 削除ではなく onDismiss を呼ぶ。
                closeDropdownMenu(dropdownMenu);
              }

              console.log(
                `[X-Observer] メニューからポストを非表示にしました: ${info.statusId}`
              );
            }
          })
        );
      }
    }

    // X 側メニューの構築完了前に挿入すると位置や構造が崩れるため、出現監視 + 少し遅延で差し込む。
    const menuObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue

          const menus = [];
          if (node.getAttribute && node.getAttribute('role') === 'menu') {
            menus.push(node);
          }
          if (node.querySelectorAll) {
            menus.push(...node.querySelectorAll('[role="menu"]'));
          }
          for (const menu of menus) {
            setTimeout(() => injectHideMenuItem(menu), 50);
          }
        }
      }
    });

    menuObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    return menuObserver
  }

  // UI 非表示用の style 要素を保持する。
  // ON/OFF のたびに style を探し直さずに済み、二重挿入も防げるため参照を保持する。
  let hideUIStyleEl = null;

  /**
   * X のヘッダーや投稿フォームを表示/非表示にする。
   * 入力: true で非表示を有効化、false で解除。
   * 出力: なし。
   * 主な処理内容:
   * 1. 有効化時は style を挿入する
   * 2. 無効化時は既存 style を除去する
   */
  function setHideUI (enabled) {
    if (enabled && !hideUIStyleEl) {
      hideUIStyleEl = GM_addStyle(HIDE_UI_CSS);
      console.log('[X-Observer] UI非表示: ON');
    } else if (!enabled && hideUIStyleEl) {
      hideUIStyleEl.remove();
      hideUIStyleEl = null;
      console.log('[X-Observer] UI非表示: OFF');
    }
  }

  /** 現在の UI 非表示状態を返す。*/
  function isHideUIEnabled () {
    return Boolean(hideUIStyleEl)
  }

  /** 常時必要なレイアウト CSS と独自メニュー CSS を適用する。*/
  function applyBaseStyles () {
    GM_addStyle(COMPACT_LAYOUT_CSS);
    GM_addStyle(CUSTOM_MENU_CSS);
  }

  const PAGE_SIZE = 500;
  const TAB_DEFINITIONS = [
    {
      key: 'users',
      label: 'ユーザーID',
      placeholder: '[@]user_id'
    },
    {
      key: 'statuses',
      label: 'ポストID',
      placeholder: 'post_id / URL'
    },
    {
      key: 'words',
      label: 'キーワード',
      placeholder: 'keyword'
    },
    {
      key: 'media',
      label: 'メディア',
      placeholder: 'リスト名'
    },
    {
      key: 'settings',
      label: '設定',
      placeholder: ''
    }
  ];

  const DIALOG_STYLE = `
  .xtlo-settings-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.66);
    backdrop-filter: blur(10px);
    z-index: 2147483647;
    padding: 16px;
  }

  .xtlo-settings-dialog {
    width: min(720px, calc(100vw - 24px));
    height: min(640px, calc(100vh - 24px));
    max-height: min(640px, calc(100vh - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      radial-gradient(circle at top left, rgba(29, 155, 240, 0.12), transparent 34%),
      linear-gradient(180deg, rgba(23, 23, 23, 0.98), rgba(9, 9, 9, 0.98));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    color: #f5f7fa;
    font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
  }

  .xtlo-settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 10px;
  }

  .xtlo-settings-title {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .xtlo-settings-close {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-tabs {
    display: flex;
    gap: 18px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-tab {
    position: relative;
    padding: 8px 0 10px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-tab[data-active="true"] {
    color: #ffffff;
  }

  .xtlo-settings-tab[data-active="true"]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 3px;
    border-radius: 999px;
    background: #1d9bf0;
  }

  .xtlo-settings-body {
    flex: 1;
    overflow: auto;
    padding: 16px 20px 14px;
  }

  .xtlo-settings-add-row {
    display: flex;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
    margin-bottom: 14px;
  }

  .xtlo-settings-input {
    flex: 1;
    border: 0;
    outline: none;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px 14px;
    color: #ffffff;
    font-size: 14px;
  }

  .xtlo-settings-input::placeholder {
    color: rgba(255, 255, 255, 0.32);
  }

  .xtlo-settings-primary {
    border: 0;
    border-radius: 10px;
    background: linear-gradient(180deg, #38a3ff, #1d84d8);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    padding: 0 16px;
    cursor: pointer;
  }

  .xtlo-settings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .xtlo-settings-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .xtlo-settings-icon {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: #dce8f5;
    background: rgba(255, 255, 255, 0.11);
    flex-shrink: 0;
  }

  .xtlo-settings-item-text {
    flex: 1;
    min-width: 0;
  }

  .xtlo-settings-item-title {
    font-size: 13px;
    font-weight: 700;
    word-break: break-all;
  }

  .xtlo-settings-item-subtitle {
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.54);
    font-size: 11px;
  }

  .xtlo-settings-danger-icon {
    border: 0;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }

  .xtlo-settings-danger-icon:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .xtlo-settings-empty {
    padding: 28px 12px;
    text-align: center;
    color: rgba(255, 255, 255, 0.54);
    font-size: 13px;
  }

  .xtlo-settings-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px 0 6px;
  }

  .xtlo-settings-page-btn {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.84);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-page-btn:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .xtlo-settings-page-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-page-current {
    width: 48px;
    text-align: center;
    padding: 6px 0;
    border-radius: 8px;
    border: 0;
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 20px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-clear {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-badge {
    border-radius: 10px;
    padding: 6px 12px;
    background: rgba(84, 95, 110, 0.72);
    color: #dce4ef;
    font-size: 12px;
    font-weight: 700;
  }

  .xtlo-settings-settings-grid {
    display: grid;
    gap: 10px;
  }

  .xtlo-settings-toggle-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
  }

  .xtlo-settings-toggle-copy {
    flex: 1;
  }

  .xtlo-settings-toggle-title {
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-toggle-desc {
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.58);
    font-size: 11px;
    line-height: 1.5;
  }

  .xtlo-settings-switch {
    position: relative;
    width: 44px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    cursor: pointer;
    flex-shrink: 0;
  }

  .xtlo-settings-switch[data-enabled="true"] {
    background: #1d9bf0;
  }

  .xtlo-settings-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #ffffff;
    transition: transform 0.18s ease;
  }

  .xtlo-settings-switch[data-enabled="true"]::after {
    transform: translateX(18px);
  }

  .xtlo-settings-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .xtlo-settings-secondary {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-hint {
    color: rgba(255, 255, 255, 0.54);
    font-size: 12px;
    line-height: 1.6;
  }

  @media (max-width: 700px) {
    .xtlo-settings-overlay {
      padding: 12px;
      align-items: stretch;
    }

    .xtlo-settings-dialog {
      width: 100%;
      height: auto;
      max-height: none;
      border-radius: 22px;
    }

    .xtlo-settings-tabs {
      gap: 20px;
      overflow: auto;
    }

    .xtlo-settings-add-row,
    .xtlo-settings-footer,
    .xtlo-settings-toggle-card {
      flex-direction: column;
      align-items: stretch;
    }

    .xtlo-settings-primary,
    .xtlo-settings-secondary,
    .xtlo-settings-switch {
      align-self: flex-start;
    }
  }
`;

  /**
   * ステータス ID または URL を statusId へ正規化する。
   * 入力: ダイアログから受け取った文字列。
   * 出力: 数字文字列、解釈できない場合は null。
   * 主な処理内容:
   * 1. 数字のみ入力はそのまま返す
   * 2. URL からは /status/<数字> の部分だけを抜き出す
   */
  function normalizeStatusInput (value) {
    if (/^\d+$/.test(value)) {
      return value
    }

    const match = value.match(/\/status\/(\d+)/);
    return match ? match[1] : null
  }

  /**
   * 入力されたページ番号を安全な範囲へ丸める。
   * 入力: ユーザー入力値と総ページ数。
   * 出力: 1 以上 totalPages 以下の整数ページ番号。
   * 主な処理内容:
   * 1. 数値へ解釈できない値は 1 に戻す
   * 2. 小数や範囲外の値を表示可能なページへ補正する
   */
  function normalizePageNumber (value, totalPages) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return 1
    }

    return Math.min(Math.max(parsed, 1), totalPages)
  }

  /**
   * 設定配列をタブごとの一覧データへ変換する。
   * 入力: タブキー。
   * 出力: 表示用アイテム配列。
   * 主な処理内容:
   * 1. config の保存形式を UI 用の title / subtitle へ整形する
   * 2. hiddenStatuses だけは期限日時も添えて表示する
   */
  function getItemsForTab (tabKey) {
    if (tabKey === 'users') {
      return config.hiddenUserIds.map(value => ({
        value,
        title: `@${value}`,
        subtitle: 'ユーザーID'
      }))
    }

    if (tabKey === 'statuses') {
      return config.hiddenStatuses.map(entry => ({
        value: entry.statusId,
        title: entry.statusId,
        subtitle: `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
      }))
    }

    if (tabKey === 'words') {
      return config.hiddenWords.map(value => ({
        value,
        title: value,
        subtitle: 'キーワード'
      }))
    }

    return config.mediaFilterLists.map(value => ({
      value,
      title: value,
      subtitle: 'メディアフィルタ'
    }))
  }

  /**
   * ダイアログに使う設定 UI を生成する。
   * 入力: 各種追加・削除・保存コールバック。
   * 出力: open / close を持つオブジェクト。
   * 主な処理内容:
   * 1. モーダル DOM を初期化する
   * 2. タブ、ページネーション、追加・削除 UI を描画する
   * 3. 設定変更時に既存保存ロジックと再適用処理を呼び出す
   */
  function createSettingsDialog ({
    addHiddenStatus,
    removeHiddenStatus,
    addHiddenUser,
    removeHiddenUser,
    addHiddenWord,
    removeHiddenWord,
    addMediaFilterList,
    removeMediaFilterList,
    setHideUI,
    setHideUIEnabled,
    applyAutoRefreshEnabled,
    setAutoRefreshEnabled,
    exportConfigToFile,
    importConfigFromFile,
    reapplyFilters
  }) {
    let styleInjected = false;
    let overlay = null;
    let currentTab = 'users';
    const pageByTab = {
      users: 1,
      statuses: 1,
      words: 1,
      media: 1,
      settings: 1
    };

    /**
     * ダイアログ共通スタイルを一度だけ挿入する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 多重に style が増えないよう初回だけ GM_addStyle を呼ぶ
     */
    function ensureStyle () {
      if (styleInjected) return
      GM_addStyle(DIALOG_STYLE);
      styleInjected = true;
    }

    /**
     * 追加対象ごとのコールバックと文言を返す。
     * 入力: タブキー。
     * 出力: 追加や削除に必要な設定情報。
     * 主な処理内容:
     * 1. タブごとに保存関数を切り替える
     * 2. 全削除ボタンの文言もここでまとめる
     */
    function getTabActions (tabKey) {
      if (tabKey === 'users') {
        return {
          items: getItemsForTab(tabKey),
          addLabel: 'Add',
          clearLabel: 'Clear all users',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenUser(value),
          removeItem: async value => removeHiddenUser(value),
          clearAll: async () => {
            for (const value of [...config.hiddenUserIds]) {
              await removeHiddenUser(value);
            }
            reapplyFilters();
          },
          normalizeInput: value => value.replace(/^@/, '')
        }
      }

      if (tabKey === 'statuses') {
        return {
          items: getItemsForTab(tabKey),
          addLabel: 'Add',
          clearLabel: 'Clear all posts',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenStatus(value),
          removeItem: async value => removeHiddenStatus(value),
          clearAll: async () => {
            for (const entry of [...config.hiddenStatuses]) {
              await removeHiddenStatus(entry.statusId);
            }
            reapplyFilters();
          },
          normalizeInput: value => normalizeStatusInput(value)
        }
      }

      if (tabKey === 'words') {
        return {
          items: getItemsForTab(tabKey),
          addLabel: 'Add',
          clearLabel: 'Clear all words',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenWord(value),
          removeItem: async value => removeHiddenWord(value),
          clearAll: async () => {
            for (const value of [...config.hiddenWords]) {
              await removeHiddenWord(value);
            }
            reapplyFilters();
          },
          normalizeInput: value => value
        }
      }

      return {
        items: getItemsForTab(tabKey),
        addLabel: 'Add',
        clearLabel: 'Clear all media',
        totalLabel: 'Media Filters',
        addItem: async value => addMediaFilterList(value),
        removeItem: async value => removeMediaFilterList(value),
        clearAll: async () => {
          for (const value of [...config.mediaFilterLists]) {
            await removeMediaFilterList(value);
          }
          reapplyFilters();
        },
        normalizeInput: value => value
      }
    }

    /**
     * タブと現在件数に応じてフッター文言を返す。
     * 入力: タブキーと件数。
     * 出力: ラベル文字列。
     * 主な処理内容:
     * 1. 設定タブだけは件数ではなく状態数として表現する
     */
    function getFooterBadgeLabel (tabKey, count) {
      if (tabKey === 'settings') {
        return `${count} Settings`
      }
      return `${count} Active Filters`
    }

    /** ゴミ箱アイコン SVG を返す。*/
    function getTrashIcon () {
      return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 6V4.5A1.5 1.5 0 0 0 14.5 3h-5A1.5 1.5 0 0 0 8 4.5V6H4v2h1v10.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8h1V6h-4zm-6-.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V6h-4V5.5zm-1 4h2v7H9v-7zm4 0h2v7h-2v-7z"/>
      </svg>
    `
    }

    /** リストアイコン SVG を返す。*/
    function getListIcon (tabKey) {
      if (tabKey === 'users') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z"/>
        </svg>
      `
      }

      if (tabKey === 'statuses') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 5h12v2H6zm0 6h12v2H6zm0 6h8v2H6z"/>
        </svg>
      `
      }

      if (tabKey === 'words') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5 5h14v2H5zm0 4h14v2H5zm0 4h9v2H5zm0 4h7v2H5z"/>
        </svg>
      `
      }

      return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8zm2 1h4v2H8zm0 3h8v2H8z"/>
      </svg>
    `
    }

    /**
     * 画面を再描画する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 現在タブに応じたリストや設定項目を描画する
     * 2. 件数とページ数からページネーション表示を更新する
     */
    function render () {
      if (!overlay) return

      const body = overlay.querySelector('.xtlo-settings-body');
      const footer = overlay.querySelector('.xtlo-settings-footer');
      const tabButtons = overlay.querySelectorAll('.xtlo-settings-tab');

      tabButtons.forEach(button => {
        button.dataset.active = String(button.dataset.tab === currentTab);
      });

      if (currentTab === 'settings') {
        body.innerHTML = `
        <div class="xtlo-settings-settings-grid">
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">X の UI を非表示</div>
              <div class="xtlo-settings-toggle-desc">ヘッダーと投稿フォームを隠して、監視専用の表示に寄せます。</div>
            </div>
            <button class="xtlo-settings-switch" data-action="toggle-hide-ui" data-enabled="${String(config.hideUIEnabled)}" aria-label="UI 非表示切り替え"></button>
          </div>
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">タイムライン自動更新</div>
              <div class="xtlo-settings-toggle-desc">最上部にいるときだけ新着ポストの読み込みを自動で実行します。</div>
            </div>
            <button class="xtlo-settings-switch" data-action="toggle-auto-refresh" data-enabled="${String(config.autoRefreshEnabled)}" aria-label="自動更新切り替え"></button>
          </div>
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">設定ファイル</div>
              <div class="xtlo-settings-toggle-desc">現在のフィルターと設定を JSON で保存、または取り込みます。</div>
            </div>
            <div class="xtlo-settings-actions">
              <button class="xtlo-settings-secondary" data-action="export-config">エクスポート</button>
              <button class="xtlo-settings-secondary" data-action="import-config">インポート</button>
            </div>
          </div>
          <div class="xtlo-settings-hint">
            ポストID は 30 日で期限切れになります。メディアタブは現在保存済みのリスト名のみを編集でき、無効な名前の入力もそのまま保存されます。
          </div>
        </div>
      `;

        footer.innerHTML = `
        <div></div>
        <div class="xtlo-settings-badge">${getFooterBadgeLabel('settings', 2)}</div>
      `;
        return
      }

      const tabDefinition = TAB_DEFINITIONS.find(tab => tab.key === currentTab);
      const actions = getTabActions(currentTab);
      const totalItems = actions.items.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      const currentPage = Math.min(pageByTab[currentTab], totalPages);
      pageByTab[currentTab] = currentPage;
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const visibleItems = actions.items.slice(startIndex, startIndex + PAGE_SIZE);

      const listMarkup = visibleItems.length
        ? visibleItems
            .map(
              item => `
              <div class="xtlo-settings-card">
                <div class="xtlo-settings-icon">${getListIcon(currentTab)}</div>
                <div class="xtlo-settings-item-text">
                  <div class="xtlo-settings-item-title">${escapeHtml(item.title)}</div>
                  <div class="xtlo-settings-item-subtitle">${escapeHtml(item.subtitle)}</div>
                </div>
                <button class="xtlo-settings-danger-icon" data-action="remove-item" data-value="${escapeAttribute(item.value)}" aria-label="削除">
                  ${getTrashIcon()}
                </button>
              </div>
            `
            )
            .join('')
        : '<div class="xtlo-settings-empty">まだ項目はありません。</div>';

      body.innerHTML = `
      <div class="xtlo-settings-add-row">
        <input class="xtlo-settings-input" type="text" placeholder="${escapeAttribute(tabDefinition.placeholder)}" />
        <button class="xtlo-settings-primary" data-action="add-item">${actions.addLabel}</button>
      </div>
      <div class="xtlo-settings-list">${listMarkup}</div>
      <div class="xtlo-settings-pagination">
        <button class="xtlo-settings-page-btn" data-action="prev-page" ${currentPage <= 1 ? 'disabled' : ''} aria-label="前のページ">‹</button>
        <div class="xtlo-settings-page-indicator">
          <input class="xtlo-settings-page-current" data-role="page-input" inputmode="numeric" value="${currentPage}" aria-label="現在のページ" />
          <div>/ ${totalPages}</div>
        </div>
        <button class="xtlo-settings-page-btn" data-action="next-page" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="次のページ">›</button>
      </div>
    `;

      footer.innerHTML = `
      <button class="xtlo-settings-clear" data-action="clear-all">${actions.clearLabel}</button>
      <div class="xtlo-settings-badge">${getFooterBadgeLabel(currentTab, totalItems)}</div>
    `;
    }

    /**
     * 現在タブの入力欄を保存処理へ渡す。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 入力を trim してタブごとの形式へ正規化する
     * 2. 保存後にフィルタを再適用して再描画する
     */
    async function handleAddItem () {
      const body = overlay.querySelector('.xtlo-settings-body');
      const input = body.querySelector('.xtlo-settings-input');
      if (!input) return

      const rawValue = input.value.trim();
      if (!rawValue) return

      const actions = getTabActions(currentTab);
      const normalizedValue = actions.normalizeInput(rawValue);
      if (!normalizedValue) {
        alert('入力内容を解釈できませんでした');
        return
      }

      await actions.addItem(normalizedValue);
      input.value = '';
      reapplyFilters();
      render();
    }

    /**
     * 現在タブの項目を 1 件削除する。
     * 入力: data-value に入った保存値。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. タブに応じた削除関数を呼ぶ
     * 2. 再適用後に空ページへ残らないようページ番号も補正する
     */
    async function handleRemoveItem (value) {
      const actions = getTabActions(currentTab);
      await actions.removeItem(value);
      reapplyFilters();

      const remainingCount = getItemsForTab(currentTab).length;
      const maxPage = Math.max(1, Math.ceil(remainingCount / PAGE_SIZE));
      pageByTab[currentTab] = Math.min(pageByTab[currentTab], maxPage);
      render();
    }

    /**
     * 現在タブの項目を全削除する。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 確認ダイアログで誤操作を防ぐ
     * 2. タブごとの clearAll を実行して再描画する
     */
    async function handleClearAll () {
      const actions = getTabActions(currentTab);
      if (actions.items.length === 0) return

      if (!confirm('このタブの項目をすべて削除しますか？')) {
        return
      }

      await actions.clearAll();
      pageByTab[currentTab] = 1;
      render();
    }

    /**
     * ページ入力欄の値を現在タブのページ番号へ反映する。
     * 入力: ページ入力欄の文字列。
     * 出力: なし。
     * 主な処理内容:
     * 1. 総ページ数を基準に不正値を 1..totalPages へ補正する
     * 2. 補正後の値を state と表示へ反映する
     */
    function applyPageInput (rawValue) {
      const totalItems = getTabActions(currentTab).items.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      const normalizedPage = normalizePageNumber(rawValue, totalPages);

      pageByTab[currentTab] = normalizedPage;
      render();
    }

    /**
     * ダイアログ内クリックをイベント委譲で処理する。
     * 入力: click イベント。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 再描画でボタンが差し替わってもリスナーを張り直さずに済むよう data-action を読む
     * 2. タブ切り替え、追加、削除、設定トグルを振り分ける
     */
    async function handleOverlayClick (event) {
      if (event.target === overlay) {
        close();
        return
      }

      const target = event.target.closest('[data-action], .xtlo-settings-tab, .xtlo-settings-close');
      if (!target) return

      if (target.classList.contains('xtlo-settings-close')) {
        close();
        return
      }

      if (target.classList.contains('xtlo-settings-tab')) {
        currentTab = target.dataset.tab;
        render();
        return
      }

      const { action } = target.dataset;
      if (!action) return

      if (action === 'add-item') {
        await handleAddItem();
        return
      }

      if (action === 'remove-item') {
        await handleRemoveItem(target.dataset.value);
        return
      }

      if (action === 'clear-all') {
        await handleClearAll();
        return
      }

      if (action === 'prev-page') {
        pageByTab[currentTab] = Math.max(1, pageByTab[currentTab] - 1);
        render();
        return
      }

      if (action === 'next-page') {
        pageByTab[currentTab] += 1;
        render();
        return
      }

      if (action === 'toggle-hide-ui') {
        const nextValue = !config.hideUIEnabled;
        setHideUI(nextValue);
        await setHideUIEnabled(nextValue);
        render();
        return
      }

      if (action === 'toggle-auto-refresh') {
        const nextValue = !config.autoRefreshEnabled;
        applyAutoRefreshEnabled(nextValue);
        await setAutoRefreshEnabled(nextValue);
        render();
        return
      }

      if (action === 'export-config') {
        exportConfigToFile();
        return
      }

      if (action === 'import-config') {
        await importConfigFromFile();
        render();
      }
    }

    /**
     * Enter キーで追加できるように入力欄のキー入力を処理する。
     * 入力: keydown イベント。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 入力欄で Enter が押されたときだけ追加処理を呼ぶ
     */
    async function handleOverlayKeydown (event) {
      if (event.key === 'Escape') {
        close();
        return
      }

      if (
        event.key === 'Enter' &&
        event.target.classList.contains('xtlo-settings-input')
      ) {
        event.preventDefault();
        await handleAddItem();
        return
      }

      if (
        event.key === 'Enter' &&
        event.target.dataset.role === 'page-input'
      ) {
        event.preventDefault();
        applyPageInput(event.target.value);
      }
    }

    /**
     * change イベントからページ入力欄の変更を反映する。
     * 入力: change イベント。
     * 出力: なし。
     * 主な処理内容:
     * 1. ページ入力欄の変更だけを拾う
     * 2. 不正値を補正して再描画する
     */
    function handleOverlayChange (event) {
      if (event.target.dataset.role !== 'page-input') {
        return
      }

      applyPageInput(event.target.value);
    }

    /**
     * ダイアログ DOM を生成して body へ挿入する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 初回にだけ overlay を作成する
     * 2. クリックとキー入力のリスナーを委譲で登録する
     */
    function ensureOverlay () {
      if (overlay) return

      overlay = document.createElement('div');
      overlay.className = 'xtlo-settings-overlay';
      overlay.innerHTML = `
      <div class="xtlo-settings-dialog" role="dialog" aria-modal="true" aria-label="X-Observer 設定">
        <div class="xtlo-settings-header">
          <div class="xtlo-settings-title">X-Observer</div>
          <button class="xtlo-settings-close" aria-label="閉じる">×</button>
        </div>
        <div class="xtlo-settings-tabs">
          ${TAB_DEFINITIONS.map(
            tab => `
              <button class="xtlo-settings-tab" data-tab="${tab.key}" data-active="false">${tab.label}</button>
            `
          ).join('')}
        </div>
        <div class="xtlo-settings-body"></div>
        <div class="xtlo-settings-footer"></div>
      </div>
    `;

      overlay.addEventListener('click', event => {
        handleOverlayClick(event).catch(error => {
          console.error('[X-Observer] 設定ダイアログ操作に失敗しました:', error);
          alert(`設定ダイアログ操作に失敗しました: ${error.message}`);
        });
      });
      overlay.addEventListener('keydown', event => {
        handleOverlayKeydown(event).catch(error => {
          console.error('[X-Observer] 設定ダイアログ入力処理に失敗しました:', error);
          alert(`設定ダイアログ入力処理に失敗しました: ${error.message}`);
        });
      });
      overlay.addEventListener('change', event => {
        try {
          handleOverlayChange(event);
        } catch (error) {
          console.error('[X-Observer] 設定ダイアログのページ変更に失敗しました:', error);
          alert(`設定ダイアログのページ変更に失敗しました: ${error.message}`);
        }
      });
    }

    /**
     * ダイアログを開く。
     * 入力: 開きたいタブキー。省略時は現在タブを維持。
     * 出力: なし。
     * 主な処理内容:
     * 1. スタイルと DOM を準備する
     * 2. body へ追加して描画する
     * 3. 最初の入力欄へフォーカスする
     */
    function open (tabKey = currentTab) {
      currentTab = tabKey;
      ensureStyle();
      ensureOverlay();
      if (!overlay.isConnected) {
        document.body.appendChild(overlay);
      }
      render();
      overlay.tabIndex = -1;
      overlay.focus();

      const input = overlay.querySelector('.xtlo-settings-input');
      if (input) {
        input.focus();
      }
    }

    /**
     * ダイアログを閉じる。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. overlay を DOM から外す
     */
    function close () {
      overlay?.remove();
    }

    return {
      open,
      close
    }
  }

  /**
   * HTML として埋め込む文字列をエスケープする。
   * 入力: 任意の文字列。
   * 出力: 安全な HTML 文字列。
   * 主な処理内容:
   * 1. innerHTML へ入れる値の記号を実体参照へ置換する
   */
  function escapeHtml (value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * 属性値へ入れる文字列をエスケープする。
   * 入力: 任意の文字列。
   * 出力: 属性値として安全な文字列。
   * 主な処理内容:
   * 1. 本実装では HTML エスケープと同じ規則で十分なため共通化する
   */
  function escapeAttribute (value) {
    return escapeHtml(value)
  }

  /**
   * prompt の戻り値を設定追加用に正規化する。
   * 入力: prompt が返した文字列または null。
   * 出力: trim 済み文字列、または空入力時の null。
   * 主な処理内容:
   * 1. キャンセル時は null を返す
   * 2. 前後空白を除去し、空文字は null 扱いにする
   */
  function normalizePromptInput (input) {
    if (input === null) return null

    const normalized = input.trim();
    return normalized || null
  }

  /**
   * 投稿 ID 入力から statusId を取り出す。
   * 入力: 数字文字列、または投稿 URL。
   * 出力: statusId、解釈できない場合は null。
   * 主な処理内容:
   * 1. 純粋な数字ならそのまま返す
   * 2. URL からは /status/<数字> を抽出する
   */
  function parseStatusId (input) {
    if (/^\d+$/.test(input)) {
      return input
    }

    // URL 全体を保存すると unrelated な数字まで拾う危険があるため、status パスだけを見る。
    const match = input.match(/\/status\/(\d+)/);
    return match ? match[1] : null
  }

  /**
   * Tampermonkey メニューへ設定操作コマンドを登録する。
   * 入力: 追加・表示・インポートなどに必要なコールバック群。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定ダイアログを開くメニューを登録する
   * 2. 既存の prompt ベース操作も後方互換として残す
   * 3. 追加やインポート後に画面へ再反映する
   */
  function registerMenuCommands ({
    addHiddenStatus,
    addHiddenUser,
    addHiddenWord,
    exportConfigToFile,
    importConfigFromFile,
    reapplyFilters,
    openSettingsDialog
  }) {
    GM_registerMenuCommand('設定ダイアログを開く', () => {
      openSettingsDialog();
    });

    GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('非表示にしたいユーザー ID を入力してください。@ あり/なしどちらでも構いません')
      );
      if (!userId) {
        console.log('[X-Observer] 空のユーザー ID 入力はキャンセルしました');
        return
      }

      await addHiddenUser(userId);
      reapplyFilters();
    });

    GM_registerMenuCommand('非表示ポストIDを追加', async () => {
      const rawInput = normalizePromptInput(
        prompt('非表示にしたいポスト ID またはポスト URL を入力してください')
      );
      if (!rawInput) {
        console.log('[X-Observer] 空のポスト ID 入力はキャンセルしました');
        return
      }

      const statusId = parseStatusId(rawInput);
      if (!statusId) {
        console.log('[X-Observer] ポスト ID を解釈できませんでした:', rawInput);
        return
      }

      await addHiddenStatus(statusId);
      reapplyFilters();
    });

    GM_registerMenuCommand('非表示キーワードを追加', async () => {
      const word = normalizePromptInput(
        prompt('非表示にしたいキーワードを入力してください')
      );
      if (!word) {
        console.log('[X-Observer] 空のキーワード入力はキャンセルしました');
        return
      }

      await addHiddenWord(word);
      reapplyFilters();
    });

    GM_registerMenuCommand('設定をエクスポート', () => {
      exportConfigToFile();
    });

    GM_registerMenuCommand('設定をインポート', async () => {
      await importConfigFromFile();
    });
  }

  /**
   * 現在の設定をエクスポート用オブジェクトへ整形する。
   * 入力: なし。
   * 出力: version 付きのプレーンオブジェクト。
   * 主な処理内容:
   * 1. 配列を複製して参照共有を避ける
   * 2. 設定画面で扱う真偽値設定も一緒に含める
   */
  function createExportData () {
    return {
      version: EXPORT_VERSION,
      mediaFilterLists: [...config.mediaFilterLists],
      hiddenUserIds: [...config.hiddenUserIds],
      hiddenWords: [...config.hiddenWords],
      hiddenStatuses: config.hiddenStatuses.map(entry => ({
        statusId: entry.statusId,
        expiresAt: entry.expiresAt
      })),
      settings: {
        hideUIEnabled: config.hideUIEnabled,
        autoRefreshEnabled: config.autoRefreshEnabled
      }
    }
  }

  /**
   * JSON から読み込んだ設定を検証し、内部で使う形式へ正規化する。
   * 入力: JSON.parse 後の値。
   * 出力: 保存可能な設定オブジェクト。
   * 主な処理内容:
   * 1. バージョンと配列構造を検証する
   * 2. v1 には無かった settings を既定値で補完する
   * 3. ユーザー ID や重複値を正規化する
   */
  function normalizeImportedConfig (raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('設定 JSON のルートはオブジェクトである必要があります')
    }

    if (![1, EXPORT_VERSION].includes(raw.version)) {
      throw new Error(`未対応の設定バージョンです: ${raw.version}`)
    }

    const { mediaFilterLists, hiddenUserIds, hiddenWords, hiddenStatuses } = raw;

    if (
      !Array.isArray(mediaFilterLists) ||
      !Array.isArray(hiddenUserIds) ||
      !Array.isArray(hiddenWords) ||
      !Array.isArray(hiddenStatuses)
    ) {
      throw new Error('設定 JSON の配列項目が不正です')
    }

    const normalizedStatuses = hiddenStatuses.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`hiddenStatuses[${index}] はオブジェクトである必要があります`)
      }
      if (typeof entry.statusId !== 'string' || !/^\d+$/.test(entry.statusId)) {
        throw new Error(`hiddenStatuses[${index}].statusId が不正です`)
      }
      if (typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) {
        throw new Error(`hiddenStatuses[${index}].expiresAt が不正です`)
      }

      return {
        statusId: entry.statusId,
        expiresAt: entry.expiresAt
      }
    });

    const rawSettings = raw.version >= 2 ? raw.settings : null;
    if (
      rawSettings !== null &&
      (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings))
    ) {
      throw new Error('settings はオブジェクトである必要があります')
    }

    return {
      mediaFilterLists: [
        ...new Set(mediaFilterLists.filter(item => typeof item === 'string'))
      ],
      hiddenUserIds: [
        ...new Set(
          hiddenUserIds
            .filter(item => typeof item === 'string')
            .map(item => item.replace(/^@/, ''))
        )
      ],
      hiddenWords: [...new Set(hiddenWords.filter(item => typeof item === 'string'))],
      hiddenStatuses: normalizedStatuses.filter(
        (entry, index, entries) =>
          entries.findIndex(item => item.statusId === entry.statusId) === index
      ),
      hideUIEnabled:
        typeof rawSettings?.hideUIEnabled === 'boolean'
          ? rawSettings.hideUIEnabled
          : true,
      autoRefreshEnabled:
        typeof rawSettings?.autoRefreshEnabled === 'boolean'
          ? rawSettings.autoRefreshEnabled
          : true
    }
  }

  /**
   * 現在の設定を JSON ファイルとしてダウンロードさせる。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定を整形して Blob 化する
   * 2. 一時的なリンクを作成してダウンロードを開始する
   */
  function exportConfigToFile () {
    const exportText = JSON.stringify(createExportData(), null, 2);
    const blob = new Blob([exportText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `xtlo-config-${timestamp}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    console.log('[X-Observer] 設定をエクスポートしました');
    alert('設定をエクスポートしました');
  }

  /**
   * JSON ファイルを選ばせて設定を取り込み、画面へ再反映する。
   * 入力: 再適用コールバックを持つオブジェクト。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. ファイル選択ダイアログを開く
   * 2. JSON を検証して保存する
   * 3. 最新設定を再読込して reapplyFilters を呼ぶ
   */
  async function importConfigFromFile ({ reapplyFilters }) {
    const file = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';

      input.addEventListener(
        'change',
        () => {
          resolve(input.files && input.files[0] ? input.files[0] : null);
        },
        { once: true }
      );
      input.click();
    });

    if (!file) {
      console.log('[X-Observer] 設定インポートはキャンセルされました');
      return
    }

    const text = await file.text();

    try {
      const parsed = JSON.parse(text);
      const normalized = normalizeImportedConfig(parsed);

      await replaceConfig(normalized);
      await loadConfig();
      reapplyFilters();

      console.log(
        '[X-Observer] 設定をインポートしました:',
        JSON.parse(JSON.stringify(config))
      );
      alert('設定をインポートしました');
    } catch (error) {
      // パース失敗時も理由を明示しておくと、ファイル形式の不一致と実装不具合を切り分けやすい。
      console.error('[X-Observer] 設定インポートに失敗しました:', error);
      alert(`設定インポートに失敗しました: ${error.message}`);
    }
  }

  (function () {

    /**
     * 保存済みの UI 非表示設定を画面へ反映して永続化状態と同期させる。
     * 入力: 非表示を有効にするかどうかの真偽値。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 表示状態を即時に切り替える
     * 2. 保存値も同じ真偽値へ更新する
     */
    async function applyHideUISetting (enabled) {
      setHideUI(enabled);
      await setHideUIEnabled(enabled);
    }

    /**
     * 保存済みの自動更新設定を画面挙動へ反映して永続化状態と同期させる。
     * 入力: 自動更新を有効にするかどうかの真偽値、自動更新コントローラー。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. interval の開始または停止を行う
     * 2. 保存値も同じ真偽値へ更新する
     */
    async function applyAutoRefreshSetting (enabled, autoRefresh) {
      autoRefresh.applyEnabledState(enabled);
      await setAutoRefreshEnabled(enabled);
    }

    /**
     * アプリ全体を初期化する。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 設定を読み込んで表示状態へ反映する
     * 2. 監視系とメニュー系の機能を初期化する
     * 3. コンソール API と設定ダイアログを接続する
     */
    async function init () {
      await loadConfig();
      console.log(
        '[X-Observer] 設定を読み込みました:',
        JSON.parse(JSON.stringify(config))
      );

      const processor = createProcessor();
      const autoRefresh = createAutoRefreshController();

      /**
       * インポート後に画面反映と設定依存機能の同期までまとめて行う。
       * 入力: なし。
       * 出力: Promise<void>
       * 主な処理内容:
       * 1. JSON から設定を取り込む
       * 2. UI 非表示と自動更新を最新設定へ再同期する
       */
      async function importConfig () {
        await importConfigFromFile({ reapplyFilters: processor.reapplyFilters });
        setHideUI(config.hideUIEnabled);
        autoRefresh.applyEnabledState(config.autoRefreshEnabled);
      }

      applyBaseStyles();
      setHideUI(config.hideUIEnabled);
      processor.processNewArticles();

      const settingsDialog = createSettingsDialog({
        addHiddenStatus,
        removeHiddenStatus,
        addHiddenUser,
        removeHiddenUser,
        addHiddenWord,
        removeHiddenWord,
        addMediaFilterList,
        removeMediaFilterList,
        setHideUI,
        setHideUIEnabled,
        applyAutoRefreshEnabled: enabled => autoRefresh.applyEnabledState(enabled),
        setAutoRefreshEnabled,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        reapplyFilters: processor.reapplyFilters
      });

      registerMenuCommands({
        addHiddenStatus,
        addHiddenUser,
        addHiddenWord,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        reapplyFilters: processor.reapplyFilters,
        openSettingsDialog: () => settingsDialog.open()
      });

      setupDropdownHideMenu({
        addHiddenStatus,
        addHiddenUser,
        reapplyFilters: processor.reapplyFilters
      });

      setupTimelineObserver({
        scheduleProcess: processor.scheduleProcess,
        handleLateMedia: processor.handleLateMedia
      });

      autoRefresh.applyEnabledState(config.autoRefreshEnabled);

      // 公開 API から設定を変えてもダイアログ表示や保存状態とずれないよう、永続化付きラッパーを公開する。
      exposeApi({
        addMediaFilterList,
        removeMediaFilterList,
        addHiddenUser,
        removeHiddenUser,
        addHiddenWord,
        removeHiddenWord,
        addHiddenStatus,
        removeHiddenStatus,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        showConfig,
        reapplyFilters: processor.reapplyFilters,
        setHideUI: applyHideUISetting,
        toggleHideUI: () => applyHideUISetting(!isHideUIEnabled()),
        startAutoRefresh: () => applyAutoRefreshSetting(true, autoRefresh),
        stopAutoRefresh: () => applyAutoRefreshSetting(false, autoRefresh),
        toggleAutoRefresh: () =>
          applyAutoRefreshSetting(!config.autoRefreshEnabled, autoRefresh),
        openSettingsDialog: () => settingsDialog.open()
      });

      console.log('[X-Observer] タイムライン監視を開始しました');
      console.log('[X-Observer] 設定操作は window.XObserver から実行できます');
    }

    init();
  })();

})();
