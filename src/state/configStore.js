import { EXPIRE_MS, STORAGE_KEYS } from '../constants.js'

// 現在の設定を一か所に集約して持つ。
// オブジェクト自体を差し替えると参照先が古いまま残るため、各モジュールはこの中身を書き換える前提で共有する。
export const config = {
  mediaFilterLists: [],
  hiddenUserIds: [],
  followUserIds: [],
  listUserIds: [],
  hiddenWords: [],
  hiddenStatuses: [],
  hideUIEnabled: true,
  autoRefreshEnabled: true
}

/**
 * 設定オブジェクトの中身を丸ごと新しい値へ更新する。
 * 入力: 次に反映したい設定オブジェクト。
 * 出力: なし。
 * 主な処理内容:
 * 1. 共有中の config オブジェクトへ配列と真偽値を上書きする
 * 2. 参照を保ったまま他モジュールへ最新設定を行き渡らせる
 */
function assignConfig (nextConfig) {
  config.mediaFilterLists = nextConfig.mediaFilterLists
  config.hiddenUserIds = nextConfig.hiddenUserIds
  config.followUserIds = nextConfig.followUserIds
  config.listUserIds = nextConfig.listUserIds
  config.hiddenWords = nextConfig.hiddenWords
  config.hiddenStatuses = nextConfig.hiddenStatuses
  config.hideUIEnabled = nextConfig.hideUIEnabled
  config.autoRefreshEnabled = nextConfig.autoRefreshEnabled
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
export async function loadConfig () {
  const stored = await GM_getValues({
    [STORAGE_KEYS.mediaFilterLists]: [],
    [STORAGE_KEYS.hiddenUserIds]: [],
    [STORAGE_KEYS.followUserIds]: [],
    [STORAGE_KEYS.listUserIds]: [],
    [STORAGE_KEYS.hiddenWords]: [],
    [STORAGE_KEYS.hiddenStatuses]: [],
    [STORAGE_KEYS.hideUIEnabled]: true,
    [STORAGE_KEYS.autoRefreshEnabled]: true
  })

  assignConfig({
    mediaFilterLists: stored[STORAGE_KEYS.mediaFilterLists],
    hiddenUserIds: stored[STORAGE_KEYS.hiddenUserIds],
    followUserIds: stored[STORAGE_KEYS.followUserIds],
    listUserIds: stored[STORAGE_KEYS.listUserIds],
    hiddenWords: stored[STORAGE_KEYS.hiddenWords],
    hiddenStatuses: stored[STORAGE_KEYS.hiddenStatuses],
    hideUIEnabled: stored[STORAGE_KEYS.hideUIEnabled],
    autoRefreshEnabled: stored[STORAGE_KEYS.autoRefreshEnabled]
  })

  // 起動時に期限切れ投稿を取り除いておくと、古い一時非表示が残留せず再適用時の判定も単純に保てる。
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

/**
 * 指定キーに対応する設定だけを保存する。
 * 入力: config オブジェクト上のキー名。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. STORAGE_KEYS から対応する保存キーを引く
 * 2. Tampermonkey ストレージへその項目だけ書き込む
 */
export async function saveKey (configKey) {
  const storageKey = STORAGE_KEYS[configKey]
  await GM_setValues({ [storageKey]: config[configKey] })
}

/**
 * 新しい設定一式をメモリとストレージへまとめて反映する。
 * 入力: 完全な設定オブジェクト。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. config へ全項目を上書きする
 * 2. 永続化対象の全キーをまとめて保存する
 */
export async function replaceConfig (nextConfig) {
  assignConfig({
    mediaFilterLists: nextConfig.mediaFilterLists,
    hiddenUserIds: nextConfig.hiddenUserIds,
    followUserIds: nextConfig.followUserIds,
    listUserIds: nextConfig.listUserIds,
    hiddenWords: nextConfig.hiddenWords,
    hiddenStatuses: nextConfig.hiddenStatuses,
    hideUIEnabled: nextConfig.hideUIEnabled,
    autoRefreshEnabled: nextConfig.autoRefreshEnabled
  })

  await GM_setValues({
    [STORAGE_KEYS.mediaFilterLists]: config.mediaFilterLists,
    [STORAGE_KEYS.hiddenUserIds]: config.hiddenUserIds,
    [STORAGE_KEYS.followUserIds]: config.followUserIds,
    [STORAGE_KEYS.listUserIds]: config.listUserIds,
    [STORAGE_KEYS.hiddenWords]: config.hiddenWords,
    [STORAGE_KEYS.hiddenStatuses]: config.hiddenStatuses,
    [STORAGE_KEYS.hideUIEnabled]: config.hideUIEnabled,
    [STORAGE_KEYS.autoRefreshEnabled]: config.autoRefreshEnabled
  })
}

/** メディアフィルタ対象リストを追加する。*/
export async function addMediaFilterList (listName) {
  if (!config.mediaFilterLists.includes(listName)) {
    config.mediaFilterLists.push(listName)
    await saveKey('mediaFilterLists')
    console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`)
  }
}

/** メディアフィルタ対象リストを削除する。*/
export async function removeMediaFilterList (listName) {
  config.mediaFilterLists = config.mediaFilterLists.filter(n => n !== listName)
  await saveKey('mediaFilterLists')
  console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`)
}

/**
 * ユーザー ID を保存用の書式へ正規化する。
 * 入力: @ の有無どちらでもよいユーザー ID。
 * 出力: 先頭の @ を除去したユーザー ID。
 * 主な処理内容:
 * 1. 手入力と自動取得で形式を揃える
 * 2. 末尾空白も除去して重複判定を安定させる
 */
function normalizeUserId (userId) {
  return userId.trim().replace(/^@/, '')
}

/**
 * 指定した分類へユーザー ID を追加する。
 * 入力: 保存先キー、ユーザー ID、ログ用分類名。
 * 出力: 追加できた場合は true、既存なら false。
 * 主な処理内容:
 * 1. 先頭の @ を除去して比較用の形式へ揃える
 * 2. 未登録時だけ配列へ追加して保存を予約する
 */
function rememberClassifiedUser (configKey, userId, label) {
  const id = normalizeUserId(userId)
  if (!id || config[configKey].includes(id)) {
    return false
  }

  config[configKey].push(id)
  void saveKey(configKey)
  console.log(`[X-Observer] ${label}ユーザー追加: @${id}`)
  return true
}

/**
 * 非表示ユーザーを追加する。
 * 入力: @ の有無どちらでもよいユーザー ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 保存時の表記ゆれを防ぐため先頭の @ を除去する
 * 2. 重複しない場合だけ設定へ追加して保存する
 */
export async function addHiddenUser (userId) {
  const id = normalizeUserId(userId)
  if (!config.hiddenUserIds.includes(id)) {
    config.hiddenUserIds.push(id)
    await saveKey('hiddenUserIds')
    console.log(`[X-Observer] 非表示ユーザー追加: @${id}`)
  }
}

/** 非表示ユーザーを削除する。*/
export async function removeHiddenUser (userId) {
  const id = normalizeUserId(userId)
  config.hiddenUserIds = config.hiddenUserIds.filter(user => user !== id)
  await saveKey('hiddenUserIds')
  console.log(`[X-Observer] 非表示ユーザー削除: @${id}`)
}

/**
 * フォローユーザーを追加する。
 * 入力: @ の有無どちらでもよいユーザー ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 保存形式へ正規化して重複を避ける
 * 2. ストレージへ保存して後続表示へ使えるようにする
 */
export async function addFollowUser (userId) {
  const id = normalizeUserId(userId)
  if (!config.followUserIds.includes(id)) {
    config.followUserIds.push(id)
    await saveKey('followUserIds')
    console.log(`[X-Observer] フォローユーザー追加: @${id}`)
  }
}

/** フォローユーザーを削除する。*/
export async function removeFollowUser (userId) {
  const id = normalizeUserId(userId)
  config.followUserIds = config.followUserIds.filter(user => user !== id)
  await saveKey('followUserIds')
  console.log(`[X-Observer] フォローユーザー削除: @${id}`)
}

/**
 * リストインユーザーを追加する。
 * 入力: @ の有無どちらでもよいユーザー ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 保存形式へ正規化して重複を避ける
 * 2. ストレージへ保存して後続表示へ使えるようにする
 */
export async function addListUser (userId) {
  const id = normalizeUserId(userId)
  if (!config.listUserIds.includes(id)) {
    config.listUserIds.push(id)
    await saveKey('listUserIds')
    console.log(`[X-Observer] リストインユーザー追加: @${id}`)
  }
}

/** リストインユーザーを削除する。*/
export async function removeListUser (userId) {
  const id = normalizeUserId(userId)
  config.listUserIds = config.listUserIds.filter(user => user !== id)
  await saveKey('listUserIds')
  console.log(`[X-Observer] リストインユーザー削除: @${id}`)
}

/**
 * 自動判定した分類ユーザーを保存する。
 * 入力: タイムライン文脈、ユーザー ID、リポストかどうか。
 * 出力: 新規追加が発生した場合は true、不要なら false。
 * 主な処理内容:
 * 1. リポストや userId なしを除外する
 * 2. [フォロー中] はフォローとして記録する
 * 3. [おすすめ] 以外のタブはリストインとして記録する
 */
export function learnClassifiedUserFromTab (tabName, userId, isRepost) {
  if (!userId || isRepost) {
    return false
  }

  if (tabName === 'フォロー中') {
    return rememberClassifiedUser('followUserIds', userId, 'フォロー')
  }

  if (tabName && tabName !== 'おすすめ') {
    return rememberClassifiedUser('listUserIds', userId, 'リストイン')
  }

  return false
}

/**
 * 非表示キーワードを追加する。
 * 入力: 追加したいキーワード文字列。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 大文字小文字違いの重複を防ぐため比較用に小文字化する
 * 2. 実際の表示値は元の文字列を保持したまま保存する
 */
export async function addHiddenWord (word) {
  // 比較だけを小文字化するのは、画面表示やエクスポート時に入力どおりの文字列を残すため。
  const normalizedWord = word.toLowerCase()

  if (!config.hiddenWords.some(item => item.toLowerCase() === normalizedWord)) {
    config.hiddenWords.push(word)
    await saveKey('hiddenWords')
    console.log(`[X-Observer] 非表示ワード追加: "${word}"`)
  }
}

/** 非表示キーワードを削除する。*/
export async function removeHiddenWord (word) {
  config.hiddenWords = config.hiddenWords.filter(item => item !== word)
  await saveKey('hiddenWords')
  console.log(`[X-Observer] 非表示ワード削除: "${word}"`)
}

/**
 * 非表示ポストを期限付きで追加する。
 * 入力: 数字文字列の statusId。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 重複登録を避ける
 * 2. 期限つきデータとして expiresAt を付けて保存する
 */
export async function addHiddenStatus (statusId) {
  if (!config.hiddenStatuses.some(entry => entry.statusId === statusId)) {
    config.hiddenStatuses.push({
      statusId,
      expiresAt: Date.now() + EXPIRE_MS
    })
    await saveKey('hiddenStatuses')
    console.log(`[X-Observer] 非表示ポスト追加: ${statusId}`)
  }
}

/** 非表示ポストを削除する。*/
export async function removeHiddenStatus (statusId) {
  config.hiddenStatuses = config.hiddenStatuses.filter(
    entry => entry.statusId !== statusId
  )
  await saveKey('hiddenStatuses')
  console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`)
}

/** 現在の設定をログへ表示する。*/
export function showConfig () {
  console.log('[X-Observer] 現在の設定:', JSON.parse(JSON.stringify(config)))
}

/**
 * UI 非表示設定を更新して保存する。
 * 入力: 非表示を有効にするかどうかの真偽値。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 真偽値へ正規化して config に反映する
 * 2. Tampermonkey ストレージへ保存する
 */
export async function setHideUIEnabled (enabled) {
  config.hideUIEnabled = Boolean(enabled)
  await saveKey('hideUIEnabled')
}

/**
 * 自動更新設定を更新して保存する。
 * 入力: 自動更新を有効にするかどうかの真偽値。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 真偽値へ正規化して config に反映する
 * 2. Tampermonkey ストレージへ保存する
 */
export async function setAutoRefreshEnabled (enabled) {
  config.autoRefreshEnabled = Boolean(enabled)
  await saveKey('autoRefreshEnabled')
}
