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
  const EXPORT_VERSION = 1;

  // Tampermonkey ストレージの保存キー一覧。
  // モジュール分割後もキー名を散らさず、互換性影響をここで追えるようにしている。
  const STORAGE_KEYS = {
    mediaFilterLists: 'xtlo_mediaFilterLists',
    hiddenUserIds: 'xtlo_hiddenUserIds',
    hiddenWords: 'xtlo_hiddenWords',
    hiddenStatuses: 'xtlo_hiddenStatuses'
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
   * タイムライン上の article から投稿情報を抽出する。
   * 入力: article 要素
   * 出力: statusId / userId / 本文 / メディア有無 / 引用情報を含むオブジェクト
   * 主な処理内容:
   * 1. 投稿 ID とユーザー ID を取る
   * 2. 本文を見た目に近い形で復元する
   * 3. 引用投稿内メディアを差し引いたうえで自前メディアを判定する
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
      hasImages,
      hasVideos,
      hasMedia: hasImages || hasVideos,
      quote
    }
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
      for (const word of config.hiddenWords) {
        if (postInfo.text.includes(word)) {
          return `hidden-word ("${word}")`
        }
      }
    }

    return null
  }

  // 現在設定の単一参照元。
  // オブジェクト自体を差し替えずに中身だけ更新することで、各モジュールの参照を維持する。
  const config = {
    mediaFilterLists: [],
    hiddenUserIds: [],
    hiddenWords: [],
    hiddenStatuses: []
  };

  /**
   * 設定オブジェクトの中身を既存参照を保ったまま更新する。
   * 入力: 次に保持したい設定オブジェクト
   * 出力: なし
   * 主な処理内容: 各配列を config に再代入し、他モジュールの参照切れを防ぐ
   */
  function assignConfig (nextConfig) {
    config.mediaFilterLists = nextConfig.mediaFilterLists;
    config.hiddenUserIds = nextConfig.hiddenUserIds;
    config.hiddenWords = nextConfig.hiddenWords;
    config.hiddenStatuses = nextConfig.hiddenStatuses;
  }

  /**
   * Tampermonkey ストレージから設定を読み込み、期限切れ投稿を掃除する。
   * 入力: なし
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 既定値つきで保存内容を読む
   * 2. メモリ上の config へ反映する
   * 3. 期限切れ hiddenStatuses を削除して保存し直す
   */
  async function loadConfig () {
    const stored = await GM_getValues({
      [STORAGE_KEYS.mediaFilterLists]: [],
      [STORAGE_KEYS.hiddenUserIds]: [],
      [STORAGE_KEYS.hiddenWords]: [],
      [STORAGE_KEYS.hiddenStatuses]: []
    });

    assignConfig({
      mediaFilterLists: stored[STORAGE_KEYS.mediaFilterLists],
      hiddenUserIds: stored[STORAGE_KEYS.hiddenUserIds],
      hiddenWords: stored[STORAGE_KEYS.hiddenWords],
      hiddenStatuses: stored[STORAGE_KEYS.hiddenStatuses]
    });

    // 起動時に期限切れを掃除しておくことで、判定側が毎回「有効期限」を気にせずに済む。
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
   * 入力: config オブジェクト上のキー名
   * 出力: Promise<void>
   * 主な処理内容: キー名を Tampermonkey ストレージキーへ引き直して保存する
   */
  async function saveKey (configKey) {
    const storageKey = STORAGE_KEYS[configKey];
    await GM_setValues({ [storageKey]: config[configKey] });
  }

  /**
   * 新しい設定一式で保存内容を丸ごと置き換える。
   * 入力: 正規化済み設定オブジェクト
   * 出力: Promise<void>
   * 主な処理内容: メモリ上の config とストレージを同じ内容へ一括で同期する
   */
  async function replaceConfig (nextConfig) {
    assignConfig({
      mediaFilterLists: nextConfig.mediaFilterLists,
      hiddenUserIds: nextConfig.hiddenUserIds,
      hiddenWords: nextConfig.hiddenWords,
      hiddenStatuses: nextConfig.hiddenStatuses
    });

    await GM_setValues({
      [STORAGE_KEYS.mediaFilterLists]: config.mediaFilterLists,
      [STORAGE_KEYS.hiddenUserIds]: config.hiddenUserIds,
      [STORAGE_KEYS.hiddenWords]: config.hiddenWords,
      [STORAGE_KEYS.hiddenStatuses]: config.hiddenStatuses
    });
  }

  /** メディアフィルタ対象リスト名を追加する。 */
  async function addMediaFilterList (listName) {
    if (!config.mediaFilterLists.includes(listName)) {
      config.mediaFilterLists.push(listName);
      await saveKey('mediaFilterLists');
      console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`);
    }
  }

  /** メディアフィルタ対象リスト名を削除する。 */
  async function removeMediaFilterList (listName) {
    config.mediaFilterLists = config.mediaFilterLists.filter(n => n !== listName);
    await saveKey('mediaFilterLists');
    console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`);
  }

  /**
   * 非表示ユーザーを追加する。
   * 入力: @ の有無どちらでもよいユーザー ID
   * 出力: Promise<void>
   * 主な処理内容: 保存形式を揃えるため、先頭の @ を除去してから重複チェックする
   */
  async function addHiddenUser (userId) {
    const id = userId.replace(/^@/, '');
    if (!config.hiddenUserIds.includes(id)) {
      config.hiddenUserIds.push(id);
      await saveKey('hiddenUserIds');
      console.log(`[X-Observer] 非表示ユーザー追加: @${id}`);
    }
  }

  /** 非表示ユーザーを削除する。 */
  async function removeHiddenUser (userId) {
    const id = userId.replace(/^@/, '');
    config.hiddenUserIds = config.hiddenUserIds.filter(user => user !== id);
    await saveKey('hiddenUserIds');
    console.log(`[X-Observer] 非表示ユーザー削除: @${id}`);
  }

  /** 非表示キーワードを追加する。 */
  async function addHiddenWord (word) {
    if (!config.hiddenWords.includes(word)) {
      config.hiddenWords.push(word);
      await saveKey('hiddenWords');
      console.log(`[X-Observer] 非表示ワード追加: "${word}"`);
    }
  }

  /** 非表示キーワードを削除する。 */
  async function removeHiddenWord (word) {
    config.hiddenWords = config.hiddenWords.filter(item => item !== word);
    await saveKey('hiddenWords');
    console.log(`[X-Observer] 非表示ワード削除: "${word}"`);
  }

  /**
   * 非表示投稿を期限つきで追加する。
   * 入力: 数値文字列の statusId
   * 出力: Promise<void>
   * 主な処理内容: 重複登録を避けつつ、有効期限を付けて保存する
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

  /** 非表示投稿を削除する。 */
  async function removeHiddenStatus (statusId) {
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.statusId !== statusId
    );
    await saveKey('hiddenStatuses');
    console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`);
  }

  /** 現在設定をログへ安全に表示する。 */
  function showConfig () {
    console.log('[X-Observer] 現在の設定:', JSON.parse(JSON.stringify(config)));
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
   * 新着投稿自動読込の制御オブジェクトを生成する。
   * 入力: なし
   * 出力: start / stop / toggle を持つオブジェクト
   * 主な処理内容: interval と有効フラグを閉じ込め、外部からは制御関数だけを公開する
   */
  function createAutoRefreshController () {
    let autoRefreshEnabled = true;
    let autoRefreshTimer = null;

    /** 「新しいポストを表示」ボタンが表示中かどうかを返す。 */
    function isNewPostButtonVisible () {
      const statusEl = document.querySelector('[role="status"]');
      if (!statusEl) return false

      const button = statusEl.querySelector('button');
      return button && button.offsetHeight > 0
    }

    /** スクロール位置がタイムライン先頭付近かどうかを返す。 */
    function isNearTop () {
      return window.scrollY <= SCROLL_TOP_THRESHOLD
    }

    /**
     * 条件を満たす場合だけ新着ボタンを押す。
     * 入力: なし
     * 出力: なし
     * 主な処理内容: ユーザーが途中まで読んでいる最中の誤更新を避けるため、先頭付近でのみ動作する
     */
    function checkAndAutoRefresh () {
      if (!autoRefreshEnabled) return

      if (isNearTop() && isNewPostButtonVisible()) {
        const button = document.querySelector('[role="status"] button');
        if (button) {
          button.click();
          console.log('[X-Observer] 新着ポストを自動読み込みしました');
        }
      }
    }

    /** interval を開始して自動更新を有効化する。 */
    function startAutoRefresh () {
      if (autoRefreshTimer) return
      autoRefreshTimer = setInterval(checkAndAutoRefresh, AUTO_REFRESH_INTERVAL);
      autoRefreshEnabled = true;
      console.log('[X-Observer] 自動更新: ON');
    }

    /** interval を止めて自動更新を無効化する。 */
    function stopAutoRefresh () {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      autoRefreshEnabled = false;
      console.log('[X-Observer] 自動更新: OFF');
    }

    /** 現在状態を反転して自動更新を切り替える。 */
    function toggleAutoRefresh () {
      if (autoRefreshEnabled) {
        stopAutoRefresh();
      } else {
        startAutoRefresh();
      }
    }

    return {
      startAutoRefresh,
      stopAutoRefresh,
      toggleAutoRefresh
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
   * 投稿の「...」メニューへ独自の非表示項目を注入する監視を開始する。
   * 入力: 非表示登録関数と再適用関数
   * 出力: MutationObserver
   * 主な処理内容:
   * 1. 直前に押された caret を記録する
   * 2. menu 出現を監視する
   * 3. 対象投稿の statusId を使って独自 menuitem を注入する
   */
  function setupDropdownHideMenu ({ addHiddenStatus, reapplyFilters }) {
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
     * 対象 menu へ「このポストを非表示」項目を差し込む。
     * 入力: role="menu" の要素
     * 出力: なし
     * 主な処理内容: 直前 caret に対応する article を見つけ、クリック時に非表示登録する
     */
    function injectHideMenuItem (menu) {
      if (menu.querySelector('.xtlo-hide-post-menuitem')) return
      if (!lastClickedCaret) return

      const article = lastClickedCaret.closest('article');
      if (!article) return

      const info = extractPostInfo(article);
      if (!info.statusId) return

      const menuItem = document.createElement('div');
      menuItem.setAttribute('role', 'menuitem');
      menuItem.setAttribute('tabindex', '0');
      menuItem.className = 'xtlo-hide-post-menuitem';
      menuItem.innerHTML = `
      <div class="xtlo-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g>
            <path d="M3.693 21.707l-1.414-1.414 2.429-2.429c-2.479-2.421-3.606-5.376-3.658-5.513l-.131-.352.131-.352c.133-.353 3.331-8.648 10.937-8.648 2.062 0 3.834.629 5.332 1.644l2.674-2.674 1.414 1.414L3.693 21.707zm-.622-9.706c.356.797 1.354 2.794 3.051 4.449l2.417-2.418c-.361-.609-.553-1.306-.553-2.032 0-2.206 1.794-4 4-4 .727 0 1.424.192 2.033.554l2.263-2.264C14.953 5.434 13.512 5 11.986 5c-5.416 0-8.258 5.535-8.915 7.001zM11.986 10c-1.103 0-2 .897-2 2 0 .441.144.861.41 1.207l2.798-2.797C12.847 10.144 12.427 10 11.986 10zm9.878 7.06l-1.5-1.5c1.094-1.222 1.858-2.534 2.264-3.56-.869-1.907-3.813-7.001-8.642-7.001-.796 0-1.542.124-2.238.332l-1.63-1.63C11.064 3.241 12.136 3 13.271 3c6.256 0 9.573 6.971 9.778 7.432l.151.354-.108.341c-.148.465-1.065 2.893-2.928 4.933z"></path>
          </g>
        </svg>
      </div>
      <div class="xtlo-label">このポストを非表示 (X-Observer)</div>
    `;

      menuItem.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();

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
      });

      menu.appendChild(menuItem);
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

  // UI 非表示用 style 要素の参照。
  // ON/OFF 切り替え時に同じ style を外せるよう、生成結果を保持している。
  let hideUIStyleEl = null;

  /**
   * X のヘッダーや投稿フォームを表示/非表示する。
   * 入力: true で非表示 ON、false で OFF
   * 出力: なし
   * 主な処理内容: GM_addStyle で差し込んだ style 要素を保持し、必要時に remove する
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

  /** 現在状態を反転して UI 非表示を切り替える。 */
  function toggleHideUI () {
    setHideUI(!hideUIStyleEl);
  }

  /** 常時必要なレイアウト CSS とメニュー CSS を適用する。 */
  function applyBaseStyles () {
    GM_addStyle(COMPACT_LAYOUT_CSS);
    GM_addStyle(CUSTOM_MENU_CSS);
  }

  /**
   * prompt の戻り値を登録用に正規化する。
   * 入力: prompt が返した文字列または null
   * 出力: trim 済み文字列。空入力やキャンセル時は null
   * 主な処理内容: 空白だけの入力を弾き、各メニュー処理の重複ロジックを減らす
   */
  function normalizePromptInput (input) {
    if (input === null) return null

    const normalized = input.trim();
    return normalized || null
  }

  /**
   * 投稿 ID 入力から statusId を解釈する。
   * 入力: 数値文字列、または投稿 URL
   * 出力: statusId。解釈不能なら null
   * 主な処理内容: 素の ID はそのまま使い、URL は /status/<数字> 部分だけを抜き出す
   */
  function parseStatusId (input) {
    if (/^\d+$/.test(input)) {
      return input
    }

    // URL 全体から雑に数値を拾うと unrelated な ID を誤登録するため、status パスに限定する。
    const match = input.match(/\/status\/(\d+)/);
    return match ? match[1] : null
  }

  /**
   * Tampermonkey メニューへ設定変更コマンドを登録する。
   * 入力: 追加・インポート・再適用などのコールバック群
   * 出力: なし
   * 主な処理内容:
   * 1. ユーザー・投稿・キーワードの追加メニューを作る
   * 2. エクスポート / インポートメニューを作る
   * 3. 登録後に現在画面へ即時反映する
   */
  function registerMenuCommands ({
    addHiddenStatus,
    addHiddenUser,
    addHiddenWord,
    exportConfigToFile,
    importConfigFromFile,
    reapplyFilters
  }) {
    GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('非表示にしたいユーザーIDを入力してください（@あり/なし両対応）')
      );
      if (!userId) {
        console.log('[X-Observer] 空のユーザーID入力は無視しました');
        return
      }

      await addHiddenUser(userId);
      reapplyFilters();
    });

    GM_registerMenuCommand('非表示ポストIDを追加', async () => {
      const rawInput = normalizePromptInput(
        prompt('非表示にしたいポストIDまたは投稿URLを入力してください')
      );
      if (!rawInput) {
        console.log('[X-Observer] 空のポストID入力は無視しました');
        return
      }

      const statusId = parseStatusId(rawInput);
      if (!statusId) {
        console.log(
          '[X-Observer] ポストIDを抽出できなかったため登録を中止しました:',
          rawInput
        );
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
        console.log('[X-Observer] 空のキーワード入力は無視しました');
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
   * 現在設定をエクスポート用の JSON 形式へ変換する。
   * 入力: なし
   * 出力: version 付きプレーンオブジェクト
   * 主な処理内容: 参照共有を避けるため、配列や要素をコピーして返す
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
      }))
    }
  }

  /**
   * JSON から読んだ設定を検証し、保存用形式へ正規化する。
   * 入力: JSON.parse 後の値
   * 出力: 保存可能な設定オブジェクト
   * 主な処理内容:
   * 1. version と各フィールド型を検証する
   * 2. hiddenStatuses の要素構造を確認する
   * 3. 重複除去や @ 除去で保存形式を揃える
   */
  function normalizeImportedConfig (raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('設定JSONのルートはオブジェクトである必要があります')
    }

    if (raw.version !== EXPORT_VERSION) {
      throw new Error(`未対応の設定バージョンです: ${raw.version}`)
    }

    const { mediaFilterLists, hiddenUserIds, hiddenWords, hiddenStatuses } = raw;

    if (
      !Array.isArray(mediaFilterLists) ||
      !Array.isArray(hiddenUserIds) ||
      !Array.isArray(hiddenWords) ||
      !Array.isArray(hiddenStatuses)
    ) {
      throw new Error('設定JSONの配列フィールド形式が不正です')
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

    // 取り込み時に表記ゆれと重複を潰しておくことで、判定側を単純な includes / some に保つ。
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
      )
    }
  }

  /**
   * 現在設定を JSON ファイルとしてダウンロードさせる。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: Blob URL と一時 a 要素を使って保存ダイアログを開く
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
   * JSON ファイルを選ばせて設定を丸ごと置き換える。
   * 入力: 再適用コールバックを持つオブジェクト
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. ファイル選択ダイアログを開く
   * 2. JSON を検証・正規化する
   * 3. 保存内容を置換し、画面へ即時反映する
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
      // 検証失敗時に保存済み設定を壊さないため、置換処理前で必ず止める。
      console.error('[X-Observer] 設定インポートに失敗しました:', error);
      alert(`設定インポートに失敗しました: ${error.message}`);
    }
  }

  (function () {

    /**
     * アプリ全体を初期化する。
     * 入力: なし
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 設定を読み込む
     * 2. 各機能モジュールを組み立てる
     * 3. observer・API・自動更新を開始する
     */
    async function init () {
      await loadConfig();
      console.log(
        '[X-Observer] 設定を読み込みました:',
        JSON.parse(JSON.stringify(config))
      );

      const processor = createProcessor();
      const autoRefresh = createAutoRefreshController();

      // import 後に現在画面へ再適用したいため、processor 完成後にラップ関数を作る。
      async function importConfig () {
        await importConfigFromFile({ reapplyFilters: processor.reapplyFilters });
      }

      // 起動時に必要な UI 初期化と即時反映。
      registerMenuCommands({
        addHiddenStatus,
        addHiddenUser,
        addHiddenWord,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        reapplyFilters: processor.reapplyFilters
      });

      setHideUI(true);
      applyBaseStyles();
      processor.processNewArticles();

      setupDropdownHideMenu({
        addHiddenStatus,
        reapplyFilters: processor.reapplyFilters
      });

      setupTimelineObserver({
        scheduleProcess: processor.scheduleProcess,
        handleLateMedia: processor.handleLateMedia
      });

      autoRefresh.startAutoRefresh();

      // 公開 API は、内部モジュール参照をそのまま束ねて console から操作可能にする。
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
        setHideUI,
        toggleHideUI,
        startAutoRefresh: autoRefresh.startAutoRefresh,
        stopAutoRefresh: autoRefresh.stopAutoRefresh,
        toggleAutoRefresh: autoRefresh.toggleAutoRefresh
      });

      console.log('[X-Observer] タイムライン監視を開始しました');
      console.log('[X-Observer] 設定変更は window.XObserver から行えます');
    }

    init();
  })();

})();
