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

;(function () {
  'use strict'

  // ========================================
  // 定数
  // ========================================
  const PROCESSED_ATTR = 'data-xtlo-processed'
  const HIDDEN_ATTR = 'data-xtlo-hidden'
  const EXPIRE_DAYS = 30
  const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000
  const EXPORT_VERSION = 1

  // ストレージキー
  const STORAGE_KEYS = {
    mediaFilterLists: 'xtlo_mediaFilterLists', // string[] メディアフィルタ対象リスト名
    hiddenUserIds: 'xtlo_hiddenUserIds', // string[] 非表示ユーザーID
    hiddenWords: 'xtlo_hiddenWords', // string[] 非表示ワード
    hiddenStatuses: 'xtlo_hiddenStatuses' // {statusId: string, expiresAt: number}[]
  }

  const AUTO_REFRESH_INTERVAL = 10 * 1000 // チェック間隔(ms)
  const SCROLL_TOP_THRESHOLD = 50 // これ以下ならトップとみなす(px)

  // ========================================
  // 設定キャッシュ（メモリ上に保持）
  // ========================================
  let config = {
    mediaFilterLists: [],
    hiddenUserIds: [],
    hiddenWords: [],
    hiddenStatuses: []
  }

  let pendingRAF = false

  // ========================================
  // UI非表示CSS
  // ========================================
  const HIDE_UI_CSS = `
    header[role="banner"] {
      display: none !important;
    }
    div:has(> div[role="progressbar"]):has(> div [data-testid="tweetTextarea_0"]) {
      display: none !important;
    }
  `

  const COMPACT_LAYOUT_CSS = `
    /* アバター列: flex-basis縮小、margin縮小 */
    article div:has(> [data-testid="Tweet-User-Avatar"]) {
      flex-basis: 20px !important;
      margin-right: 4px !important;
    }

    /* アバター本体と内部要素のサイズ縮小 */
    article [data-testid="Tweet-User-Avatar"],
    article [data-testid="Tweet-User-Avatar"] div,
    article [data-testid="Tweet-User-Avatar"] a,
    article [data-testid="Tweet-User-Avatar"] img {
      width: 20px !important;
      height: 20px !important;
      min-width: 20px !important;
      min-height: 20px !important;
    }
  `

  let hideUIStyleEl = null

  function setHideUI (enabled) {
    if (enabled && !hideUIStyleEl) {
      hideUIStyleEl = GM_addStyle(HIDE_UI_CSS)
      console.log('[X-Observer] UI非表示: ON')
    } else if (!enabled && hideUIStyleEl) {
      hideUIStyleEl.remove()
      hideUIStyleEl = null
      console.log('[X-Observer] UI非表示: OFF')
    }
  }

  function toggleHideUI () {
    setHideUI(!hideUIStyleEl)
  }

  // ========================================
  // ストレージ操作
  // ========================================

  /** ストレージから設定を読み込み、期限切れstatusを掃除する */
  async function loadConfig () {
    const stored = await GM_getValues({
      [STORAGE_KEYS.mediaFilterLists]: [],
      [STORAGE_KEYS.hiddenUserIds]: [],
      [STORAGE_KEYS.hiddenWords]: [],
      [STORAGE_KEYS.hiddenStatuses]: []
    })

    config.mediaFilterLists = stored[STORAGE_KEYS.mediaFilterLists]
    config.hiddenUserIds = stored[STORAGE_KEYS.hiddenUserIds]
    config.hiddenWords = stored[STORAGE_KEYS.hiddenWords]
    config.hiddenStatuses = stored[STORAGE_KEYS.hiddenStatuses]

    // 期限切れstatusを削除
    const now = Date.now()
    const before = config.hiddenStatuses.length
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.expiresAt > now
    )
    if (config.hiddenStatuses.length !== before) {
      await saveKey('hiddenStatuses')
      console.log(
        `[X-Observer] 期限切れの非表示ポストを ${
          before - config.hiddenStatuses.length
        } 件削除しました`
      )
    }
  }

  /** 指定キーをストレージに保存する */
  async function saveKey (configKey) {
    const storageKey = STORAGE_KEYS[configKey]
    await GM_setValues({ [storageKey]: config[configKey] })
  }

  /**
   * 現在の設定をエクスポート用オブジェクトへ変換する。
   * 入力: なし
   * 出力: version と全設定を含むプレーンオブジェクト
   * 主な処理内容: 現在メモリ上にある config を、将来の互換性を持たせた version 付き形式へ詰め替える
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
   * JSON から読み込んだ設定オブジェクトを検証し、内部保存向けに正規化する。
   * 入力: JSON.parse 後の値
   * 出力: 保存可能な設定オブジェクト
   * 主な処理内容:
   * 1. version と各配列フィールドの存在と型を確認する
   * 2. 重複除去や userId の @ 除去で保存形式を揃える
   * 3. hiddenStatuses の要素構造を最低限検証する
   */
  function normalizeImportedConfig (raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('設定JSONのルートはオブジェクトである必要があります')
    }

    if (raw.version !== EXPORT_VERSION) {
      throw new Error(`未対応の設定バージョンです: ${raw.version}`)
    }

    const {
      mediaFilterLists,
      hiddenUserIds,
      hiddenWords,
      hiddenStatuses
    } = raw

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
    })

    return {
      mediaFilterLists: [...new Set(mediaFilterLists.filter(item => typeof item === 'string'))],
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
   * 読み込んだ設定で現在の保存内容を丸ごと置き換える。
   * 入力: 正規化済み設定オブジェクト
   * 出力: なし
   * 主な処理内容: メモリ上の config と Tampermonkey ストレージを同じ内容へ一括更新する
   */
  async function replaceConfig (nextConfig) {
    config = {
      mediaFilterLists: nextConfig.mediaFilterLists,
      hiddenUserIds: nextConfig.hiddenUserIds,
      hiddenWords: nextConfig.hiddenWords,
      hiddenStatuses: nextConfig.hiddenStatuses
    }

    await GM_setValues({
      [STORAGE_KEYS.mediaFilterLists]: config.mediaFilterLists,
      [STORAGE_KEYS.hiddenUserIds]: config.hiddenUserIds,
      [STORAGE_KEYS.hiddenWords]: config.hiddenWords,
      [STORAGE_KEYS.hiddenStatuses]: config.hiddenStatuses
    })
  }

  /**
   * 現在の設定を JSON ファイルとしてダウンロードする。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: Blob と一時リンクを使って、ユーザー操作起点のメニューから保存ダイアログを開く
   */
  function exportConfigToFile () {
    const exportText = JSON.stringify(createExportData(), null, 2)
    const blob = new Blob([exportText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    anchor.href = url
    anchor.download = `xtlo-config-${timestamp}.json`

    // メニュー操作から直接ダウンロードさせるため、不可視リンクを一時的に DOM へ追加して click を発火する。
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    console.log('[X-Observer] 設定をエクスポートしました')
    alert('設定をエクスポートしました')
  }

  /**
   * JSON ファイルから設定を読み込み、現在の保存内容を置き換える。
   * 入力: なし
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. ファイル選択ダイアログを開く
   * 2. JSON を読み込んで検証・正規化する
   * 3. 保存内容を置き換え、再読込と再判定で画面へ反映する
   */
  async function importConfigFromFile () {
    const file = await new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'

      // メニューからファイル選択を開くため、一時 input を使ってブラウザ標準の選択UIへ委ねる。
      input.addEventListener(
        'change',
        () => {
          resolve(input.files && input.files[0] ? input.files[0] : null)
        },
        { once: true }
      )
      input.click()
    })

    if (!file) {
      console.log('[X-Observer] 設定インポートはキャンセルされました')
      return
    }

    const text = await file.text()

    try {
      const parsed = JSON.parse(text)
      const normalized = normalizeImportedConfig(parsed)

      await replaceConfig(normalized)
      await loadConfig()
      reapplyFilters()

      console.log('[X-Observer] 設定をインポートしました:', JSON.parse(JSON.stringify(config)))
      alert('設定をインポートしました')
    } catch (error) {
      // 不正なJSONや想定外形式で保存内容を壊さないため、検証失敗時は置換処理へ進ませない。
      console.error('[X-Observer] 設定インポートに失敗しました:', error)
      alert(`設定インポートに失敗しました: ${error.message}`)
    }
  }

  // ========================================
  // 設定変更用API（コンソールから呼び出し可能）
  // ========================================

  /** メディアフィルタ対象リストを追加 */
  async function addMediaFilterList (listName) {
    if (!config.mediaFilterLists.includes(listName)) {
      config.mediaFilterLists.push(listName)
      await saveKey('mediaFilterLists')
      console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`)
    }
  }

  /** メディアフィルタ対象リストを削除 */
  async function removeMediaFilterList (listName) {
    config.mediaFilterLists = config.mediaFilterLists.filter(
      n => n !== listName
    )
    await saveKey('mediaFilterLists')
    console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`)
  }

  /** 非表示ユーザーIDを追加 */
  async function addHiddenUser (userId) {
    const id = userId.replace(/^@/, '')
    if (!config.hiddenUserIds.includes(id)) {
      config.hiddenUserIds.push(id)
      await saveKey('hiddenUserIds')
      console.log(`[X-Observer] 非表示ユーザー追加: @${id}`)
    }
  }

  /** 非表示ユーザーIDを削除 */
  async function removeHiddenUser (userId) {
    const id = userId.replace(/^@/, '')
    config.hiddenUserIds = config.hiddenUserIds.filter(u => u !== id)
    await saveKey('hiddenUserIds')
    console.log(`[X-Observer] 非表示ユーザー削除: @${id}`)
  }

  /** 非表示ワードを追加 */
  async function addHiddenWord (word) {
    if (!config.hiddenWords.includes(word)) {
      config.hiddenWords.push(word)
      await saveKey('hiddenWords')
      console.log(`[X-Observer] 非表示ワード追加: "${word}"`)
    }
  }

  /** 非表示ワードを削除 */
  async function removeHiddenWord (word) {
    config.hiddenWords = config.hiddenWords.filter(w => w !== word)
    await saveKey('hiddenWords')
    console.log(`[X-Observer] 非表示ワード削除: "${word}"`)
  }

  /** 非表示ポスト(statusId)を追加（30日間） */
  async function addHiddenStatus (statusId) {
    if (!config.hiddenStatuses.some(e => e.statusId === statusId)) {
      config.hiddenStatuses.push({
        statusId,
        expiresAt: Date.now() + EXPIRE_MS
      })
      await saveKey('hiddenStatuses')
      console.log(`[X-Observer] 非表示ポスト追加: ${statusId}`)
    }
  }

  /** 非表示ポスト(statusId)を削除 */
  async function removeHiddenStatus (statusId) {
    config.hiddenStatuses = config.hiddenStatuses.filter(
      e => e.statusId !== statusId
    )
    await saveKey('hiddenStatuses')
    console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`)
  }

  /** 現在の設定を表示 */
  function showConfig () {
    console.log('[X-Observer] 現在の設定:', JSON.parse(JSON.stringify(config)))
  }

  /**
   * prompt の入力値を前処理し、空入力を除外した文字列を返す。
   * 入力: prompt が返した文字列または null
   * 出力: 前後空白を除去した文字列。キャンセルや空入力時は null
   * 主な処理内容: trim による正規化と、空文字の登録防止
   */
  function normalizePromptInput (input) {
    if (input === null) return null
    const normalized = input.trim()
    return normalized || null
  }

  /**
   * ポストID入力から statusId を取り出す。
   * 入力: 数値ID文字列、または X/Twitter の投稿 URL
   * 出力: 抽出できた statusId。解釈できない場合は null
   * 主な処理内容:
   * 1. 数値だけの入力はそのまま採用する
   * 2. URL 入力は /status/<数字> を正規表現で抽出する
   */
  function parseStatusId (input) {
    if (/^\d+$/.test(input)) {
      return input
    }

    // URL 全体ではなく /status/<数字> に限定して抽出することで、無関係な数値列の誤登録を防ぐ。
    const match = input.match(/\/status\/(\d+)/)
    return match ? match[1] : null
  }

  /**
   * Tampermonkey メニューから非表示対象を登録する。
   * 入力: なし（各メニュー選択時に prompt から文字列を受け取る）
   * 出力: なし
   * 主な処理内容:
   * 1. ユーザーID、ポストID、キーワードの順でメニューを登録する
   * 2. エクスポート / インポートメニューを追加する
   * 3. 入力値を正規化し、既存の addHiddenUser / addHiddenStatus / addHiddenWord を呼ぶ
   * 4. 登録やインポート後に reapplyFilters で現在のタイムラインへ即時反映する
   */
  function registerMenuCommands () {
    GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('非表示にしたいユーザーIDを入力してください（@あり/なし両対応）')
      )
      if (!userId) {
        console.log('[X-Observer] 空のユーザーID入力は無視しました')
        return
      }

      await addHiddenUser(userId)

      // メニューから登録した設定を現在表示中の投稿にも即時反映するため、保存後に再判定する。
      reapplyFilters()
    })

    GM_registerMenuCommand('非表示ポストIDを追加', async () => {
      const rawInput = normalizePromptInput(
        prompt('非表示にしたいポストIDまたは投稿URLを入力してください')
      )
      if (!rawInput) {
        console.log('[X-Observer] 空のポストID入力は無視しました')
        return
      }

      const statusId = parseStatusId(rawInput)
      if (!statusId) {
        console.log(
          '[X-Observer] ポストIDを抽出できなかったため登録を中止しました:',
          rawInput
        )
        return
      }

      await addHiddenStatus(statusId)
      reapplyFilters()
    })

    GM_registerMenuCommand('非表示キーワードを追加', async () => {
      const word = normalizePromptInput(
        prompt('非表示にしたいキーワードを入力してください')
      )
      if (!word) {
        console.log('[X-Observer] 空のキーワード入力は無視しました')
        return
      }

      await addHiddenWord(word)
      reapplyFilters()
    })

    GM_registerMenuCommand('設定をエクスポート', () => {
      exportConfigToFile()
    })

    GM_registerMenuCommand('設定をインポート', async () => {
      await importConfigFromFile()
    })
  }

  // グローバルに公開
  unsafeWindow.XObserver = {
    addMediaFilterList,
    removeMediaFilterList,
    addHiddenUser,
    removeHiddenUser,
    addHiddenWord,
    removeHiddenWord,
    addHiddenStatus,
    removeHiddenStatus,
    exportConfigToFile,
    importConfigFromFile,
    showConfig,
    reapplyFilters,
    setHideUI,
    toggleHideUI,
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh
  }

  // ========================================
  // フィルタリング判定
  // ========================================

  /**
   * ポスト情報をもとに非表示にすべきか判定する
   * @returns {string|null} 非表示理由（nullなら表示）
   */
  function shouldHide (tabName, postInfo) {
    // 1. メディアフィルタ: 指定リストではメディアありポストのみ表示
    //    → メディアなしポストを非表示にする
    if (
      tabName &&
      config.mediaFilterLists.includes(tabName) &&
      !postInfo.hasMedia
    ) {
      return `media-filter (list: ${tabName})`
    }

    // 2. 非表示ユーザーID
    if (postInfo.userId && config.hiddenUserIds.includes(postInfo.userId)) {
      return `hidden-user (@${postInfo.userId})`
    }

    // 3. 非表示ポスト(statusId)
    if (
      postInfo.statusId &&
      config.hiddenStatuses.some(e => e.statusId === postInfo.statusId)
    ) {
      return `hidden-status (${postInfo.statusId})`
    }

    // 4. 非表示ワード（本文に含まれるか）
    if (postInfo.text) {
      for (const word of config.hiddenWords) {
        if (postInfo.text.includes(word)) {
          return `hidden-word ("${word}")`
        }
      }
    }

    return null
  }

  // ========================================
  // 新着ポスト自動読み込み
  // ========================================

  let autoRefreshEnabled = true
  let autoRefreshTimer = null

  /**
   * 「新しいポストを表示」ボタンが可視かどうか
   */
  function isNewPostButtonVisible () {
    const statusEl = document.querySelector('[role="status"]')
    if (!statusEl) return false
    const button = statusEl.querySelector('button')
    return button && button.offsetHeight > 0
  }

  /**
   * スクロール位置がほぼトップか
   */
  function isNearTop () {
    return window.scrollY <= SCROLL_TOP_THRESHOLD
  }

  /**
   * 新着ボタンが見えていて、かつトップにいたらクリック
   */
  function checkAndAutoRefresh () {
    if (!autoRefreshEnabled) return
    if (isNearTop() && isNewPostButtonVisible()) {
      const button = document.querySelector('[role="status"] button')
      if (button) {
        button.click()
        console.log('[X-Observer] 新着ポストを自動読み込みしました')
      }
    }
  }

  function startAutoRefresh () {
    if (autoRefreshTimer) return
    autoRefreshTimer = setInterval(checkAndAutoRefresh, AUTO_REFRESH_INTERVAL)
    autoRefreshEnabled = true
    console.log('[X-Observer] 自動更新: ON')
  }

  function stopAutoRefresh () {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    autoRefreshEnabled = false
    console.log('[X-Observer] 自動更新: OFF')
  }

  function toggleAutoRefresh () {
    if (autoRefreshEnabled) {
      stopAutoRefresh()
    } else {
      startAutoRefresh()
    }
  }

  // ========================================
  // ポスト情報抽出（前バージョンと同じ）
  // ========================================

  function getActiveTabName () {
    const activeTab = document.querySelector(
      '[role="tablist"] [role="tab"][aria-selected="true"]'
    )
    return activeTab ? activeTab.textContent.trim() : null
  }

  function getQuoteStatusIdFromFiber (quoteDivElement) {
    const fiberKey = Object.keys(quoteDivElement).find(k =>
      k.startsWith('__reactFiber$')
    )
    if (!fiberKey) return null
    let fiber = quoteDivElement[fiberKey]
    for (let i = 0; i < 15 && fiber; i++) {
      const props = fiber.memoizedProps || {}
      if (props.link && typeof props.link === 'object' && props.link.pathname) {
        const match = props.link.pathname.match(/\/status\/(\d+)/)
        if (match) return match[1]
      }
      fiber = fiber.return
    }
    return null
  }

  function getQuoteStatusIdFromDOM (article, quoteUserId) {
    if (!quoteUserId) return null
    const links = article.querySelectorAll('a[href*="/status/"]')
    for (const link of links) {
      const href = link.getAttribute('href')
      if (href.includes('/' + quoteUserId + '/status/')) {
        const match = href.match(/\/status\/(\d+)/)
        if (match) return match[1]
      }
    }
    return null
  }

  /**
   * tweetText 要素から、画面に表示されているすべての文字を取得する。
   * ・絵文字 (IMG alt) を復元する
   * ・URL リンクは title 属性（実URL）があればそちらを優先する
   * ・ハッシュタグ、@メンションはそのまま取得される
   */
  function getFullVisibleText (element) {
    let text = ''
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IMG') {
          // 絵文字: alt 属性に Unicode 絵文字が入っている
          text += node.getAttribute('alt') || ''
        } else if (node.tagName === 'A') {
          // リンク要素
          const href = node.getAttribute('href') || ''
          const title = node.getAttribute('title')
          if (title && href.startsWith('http')) {
            // 外部URLリンク: title に実URLが入っている（t.co短縮の展開先）
            text += title
          } else {
            // ハッシュタグリンク、@メンションリンクなど
            text += getFullVisibleText(node)
          }
        } else {
          // SPAN 等: 再帰的に処理
          text += getFullVisibleText(node)
        }
      }
    }
    return text
  }

  function extractQuoteInfo (article, quoteDivElement) {
    const avatarEl = quoteDivElement.querySelector(
      '[data-testid^="UserAvatar-Container-"]'
    )
    const userId = avatarEl
      ? avatarEl
          .getAttribute('data-testid')
          .replace('UserAvatar-Container-', '')
      : null

    const tweetTextEl = quoteDivElement.querySelector(
      '[data-testid="tweetText"]'
    )
    const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : ''

    const hasImages =
      quoteDivElement.querySelectorAll('[data-testid="tweetPhoto"]').length > 0
    const hasVideos =
      quoteDivElement.querySelectorAll(
        '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
      ).length > 0

    const statusId =
      getQuoteStatusIdFromFiber(quoteDivElement) ||
      getQuoteStatusIdFromDOM(article, userId)

    return {
      statusId: statusId || null,
      userId,
      text,
      hasImages,
      hasVideos,
      hasMedia: hasImages || hasVideos
    }
  }

  function extractPostInfo (article) {
    const statusLink = article.querySelector('a[href*="/status/"]')
    let statusId = null
    if (statusLink) {
      const match = statusLink.getAttribute('href').match(/\/status\/(\d+)/)
      if (match) statusId = match[1]
    }

    const avatarEl = article.querySelector(
      '[data-testid^="UserAvatar-Container-"]'
    )
    const userId = avatarEl
      ? avatarEl
          .getAttribute('data-testid')
          .replace('UserAvatar-Container-', '')
      : null

    const tweetTextEl = article.querySelector('[data-testid="tweetText"]')
    const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : ''

    const quoteDivElement = article.querySelector(
      'div[role="link"][tabindex="0"]'
    )

    const totalPhotos = article.querySelectorAll(
      '[data-testid="tweetPhoto"]'
    ).length
    const totalVideos = article.querySelectorAll(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
    ).length

    let quotePhotos = 0
    let quoteVideos = 0
    if (quoteDivElement) {
      quotePhotos = quoteDivElement.querySelectorAll(
        '[data-testid="tweetPhoto"]'
      ).length
      quoteVideos = quoteDivElement.querySelectorAll(
        '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
      ).length
    }

    const hasImages = totalPhotos - quotePhotos > 0
    const hasVideos = totalVideos - quoteVideos > 0

    const quote = quoteDivElement
      ? extractQuoteInfo(article, quoteDivElement)
      : null

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

  // ========================================
  // 非表示/表示の適用
  // ========================================

  /** articleの仮想スクロールセル(position:absolute の祖先)を取得 */
  function getCellDiv (article) {
    let el = article
    for (let i = 0; i < 6; i++) {
      el = el.parentElement
      if (!el) return null
      if (el.style && el.style.position === 'absolute') return el
    }
    return null
  }

  /** articleを非表示にする */
  function hideArticle (article, reason) {
    const cellDiv = getCellDiv(article)
    if (cellDiv) {
      cellDiv.style.display = 'none'
    }
    article.setAttribute(HIDDEN_ATTR, reason)
  }

  /** articleの非表示を解除する */
  function unhideArticle (article) {
    const cellDiv = getCellDiv(article)
    if (cellDiv) {
      cellDiv.style.display = ''
    }
    article.removeAttribute(HIDDEN_ATTR)
  }

  // ========================================
  // メイン処理
  // ========================================
  /*
  function processNewArticles() {
    const articles = document.querySelectorAll(
      `article:not([${PROCESSED_ATTR}])`
    );
    if (articles.length === 0) return;

    const tabName = getActiveTabName();

    articles.forEach((article) => {
      // 中身がまだ構築されていない場合は後で再処理する
      // アバターの有無で判定（アバターは全ポストに必ず存在する）
      const avatar = article.querySelector(
        '[data-testid="Tweet-User-Avatar"]'
      );
      if (!avatar) {
        // まだ中身が空 → 200ms後に再処理を試みる（マークしない）
        setTimeout(scheduleProcess, 200);
        return;
      }

      article.setAttribute(PROCESSED_ATTR, 'true');

      const info = extractPostInfo(article);
      if (!info.statusId) return;

      console.log('[X-Observer]', { tab: tabName, ...info });

      const hideReason = shouldHide(tabName, info);
      if (hideReason) {
        hideArticle(article, hideReason);
        console.log(`[X-Observer] 非表示: ${hideReason}`, info.statusId);
      }
    });
  }
*/

  function processNewArticles () {
    const articles = document.querySelectorAll(
      `article:not([${PROCESSED_ATTR}])`
    )
    if (articles.length === 0) return

    const tabName = getActiveTabName()

    articles.forEach(article => {
      article.setAttribute(PROCESSED_ATTR, 'true')

      const info = extractPostInfo(article)
      if (!info.statusId) return

      console.log('[X-Observer]', { tab: tabName, ...info })

      // フィルタリング判定
      const hideReason = shouldHide(tabName, info)
      if (hideReason) {
        hideArticle(article, hideReason)
        console.log(`[X-Observer] 非表示: ${hideReason}`, info.statusId)
      }
    })
  }

  /**
   * メディア要素が後から追加された場合に、処理済みarticleを再判定する
   */
  function handleLateMedia (article) {
    const tabName = getActiveTabName()
    const info = extractPostInfo(article)
    if (!info.statusId) return

    // ログを更新
    console.log('[X-Observer] メディア遅延検出、再判定:', {
      tab: tabName,
      ...info
    })

    // フィルタを再判定
    const hideReason = shouldHide(tabName, info)
    const currentlyHidden = article.hasAttribute(HIDDEN_ATTR)

    if (hideReason && !currentlyHidden) {
      hideArticle(article, hideReason)
    } else if (!hideReason && currentlyHidden) {
      unhideArticle(article)
    }
  }

  /** 全ポストに対してフィルタを再適用する（設定変更後に使用） */
  function reapplyFilters () {
    const tabName = getActiveTabName()
    const articles = document.querySelectorAll(`article[${PROCESSED_ATTR}]`)
    let hiddenCount = 0
    let shownCount = 0

    articles.forEach(article => {
      const info = extractPostInfo(article)
      if (!info.statusId) return

      const hideReason = shouldHide(tabName, info)
      const currentlyHidden = article.hasAttribute(HIDDEN_ATTR)

      if (hideReason && !currentlyHidden) {
        hideArticle(article, hideReason)
        hiddenCount++
      } else if (!hideReason && currentlyHidden) {
        unhideArticle(article)
        shownCount++
      }
    })

    console.log(
      `[X-Observer] フィルタ再適用: ${hiddenCount} 件非表示, ${shownCount} 件再表示`
    )
  }

  function scheduleProcess () {
    if (pendingRAF) return
    pendingRAF = true
    requestAnimationFrame(() => {
      pendingRAF = false
      processNewArticles()
    })
  }

  // ========================================
  // 起動
  // ========================================

  async function init () {
    await loadConfig()
    console.log(
      '[X-Observer] 設定を読み込みました:',
      JSON.parse(JSON.stringify(config))
    )

    registerMenuCommands()

    // UI非表示を有効化（初期状態ON）
    setHideUI(true)
    GM_addStyle(COMPACT_LAYOUT_CSS)
    processNewArticles()

    const observer = new MutationObserver(mutations => {
      let hasNewArticle = false

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue

          // 新しいarticleの追加を検知
          if (node.querySelector && node.querySelector('article')) {
            hasNewArticle = true
          }

          // tweetPhoto / videoPlayer が処理済みarticle内に追加された場合
          const mediaNodes = []
          if (
            node.getAttribute &&
            (node.getAttribute('data-testid') === 'tweetPhoto' ||
              node.getAttribute('data-testid') === 'videoPlayer' ||
              node.getAttribute('data-testid') === 'videoComponent')
          ) {
            mediaNodes.push(node)
          }
          if (node.querySelectorAll) {
            mediaNodes.push(
              ...node.querySelectorAll(
                '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
              )
            )
          }

          for (const media of mediaNodes) {
            const article = media.closest('article')
            if (article && article.hasAttribute(PROCESSED_ATTR)) {
              handleLateMedia(article)
            }
          }
        }
      }

      if (hasNewArticle) {
        scheduleProcess()
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true
    })

    // 新着ポスト自動読み込みを開始
    startAutoRefresh()

    console.log('[X-Observer] タイムライン監視を開始しました')
    console.log('[X-Observer] 設定変更は window.XObserver から行えます')
  }

  init()
})()
