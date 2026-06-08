import { EXPIRE_MS, STORAGE_KEYS } from '../constants.js'
import { normalizeUserId } from '../utils/userIds.js'

const DEFAULT_CUSTOM_CATEGORY_COLOR = '#f5c542'

// 現在の設定を一か所に集約して持つ。
// オブジェクト自体を差し替えると参照先が古いまま残るため、各モジュールはこの中身を書き換える前提で共有する。
export const config = {
  mediaFilterLists: [],
  hiddenUserIds: [],
  followUserIds: [],
  listUserIds: [],
  customUserCategories: [],
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
  config.customUserCategories = nextConfig.customUserCategories
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
    [STORAGE_KEYS.customUserCategories]: [],
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
    customUserCategories: stored[STORAGE_KEYS.customUserCategories],
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
    customUserCategories: nextConfig.customUserCategories,
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
    [STORAGE_KEYS.customUserCategories]: config.customUserCategories,
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
 * 分類色を保存用の HEX カラーへ正規化する。
 * 入力: ユーザーが選んだ色文字列。
 * 出力: #rrggbb 形式の色。未指定や不正値は既定色。
 * 主な処理内容:
 * 1. color input とインポート値を同じ形式へ揃える
 * 2. CSS へ直接渡す値なので HEX 形式以外は既定色へ戻す
 */
function normalizeCategoryColor (color) {
  const normalized = String(color || '').trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(normalized)
    ? normalized
    : DEFAULT_CUSTOM_CATEGORY_COLOR
}


/**
 * ユーザー定義分類 ID を生成する。
 * 入力: 分類名。
 * 出力: 保存に使う分類 ID。
 * 主な処理内容:
 * 1. 分類名を小文字化して URL セーフ寄りの文字へ置き換える
 * 2. 同名分類が重なった場合も衝突しないよう時刻を付ける
 */
function createCustomUserCategoryId (label) {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  return `custom-${base || 'category'}-${Date.now().toString(36)}`
}

/**
 * ユーザー定義分類を ID で探す。
 * 入力: 分類 ID。
 * 出力: 分類オブジェクト。見つからない場合は null。
 * 主な処理内容:
 * 1. customUserCategories から ID が一致する分類を返す
 */
function findCustomUserCategory (categoryId) {
  return config.customUserCategories.find(category => category.id === categoryId) ?? null
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
 * ユーザー定義分類を追加する。
 * 入力: 追加したい分類名と任意の分類色。
 * 出力: 作成した分類オブジェクト。空名または重複名なら null。
 * 主な処理内容:
 * 1. 分類名を trim して空入力を除外する
 * 2. 既存分類名と重複しない場合だけ ID、色、空のユーザー配列を保存する
 */
export async function addCustomUserCategory (label, color = DEFAULT_CUSTOM_CATEGORY_COLOR) {
  const normalizedLabel = label.trim()
  if (
    !normalizedLabel ||
    config.customUserCategories.some(category => category.label === normalizedLabel)
  ) {
    return null
  }

  const category = {
    id: createCustomUserCategoryId(normalizedLabel),
    label: normalizedLabel,
    color: normalizeCategoryColor(color),
    userIds: []
  }

  config.customUserCategories.push(category)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ユーザー定義分類追加: ${normalizedLabel}`)
  return category
}

/**
 * ユーザー定義分類を削除する。
 * 入力: 削除したい分類 ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. ID が一致しない分類だけを残す
 * 2. 分類に紐づくユーザー ID も分類ごと削除して保存する
 */
export async function removeCustomUserCategory (categoryId) {
  const category = findCustomUserCategory(categoryId)
  config.customUserCategories = config.customUserCategories.filter(
    item => item.id !== categoryId
  )
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ユーザー定義分類削除: ${category?.label ?? categoryId}`)
}


/**
 * ユーザー定義分類の色を変更する。
 * 入力: 分類 ID、#rrggbb 形式の色。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 分類 ID から更新対象を探す
 * 2. 色を安全な HEX 形式へ正規化して保存する
 */
export async function setCustomUserCategoryColor (categoryId, color) {
  const category = findCustomUserCategory(categoryId)
  if (!category) {
    return
  }

  category.color = normalizeCategoryColor(color)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ${category.label}分類色変更: ${category.color}`)
}

/**
 * ユーザー定義分類へユーザー ID を追加する。
 * 入力: 分類 ID、@ の有無どちらでもよいユーザー ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 分類 ID から保存先を探す
 * 2. ユーザー ID を正規化し、未登録時だけ追加して保存する
 */
export async function addCustomCategoryUser (categoryId, userId) {
  const category = findCustomUserCategory(categoryId)
  const id = normalizeUserId(userId)
  if (!category || !id || category.userIds.includes(id)) {
    return
  }

  category.userIds.push(id)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ${category.label}ユーザー追加: @${id}`)
}

/**
 * ユーザー定義分類からユーザー ID を削除する。
 * 入力: 分類 ID、@ の有無どちらでもよいユーザー ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 分類 ID から保存先を探す
 * 2. 正規化したユーザー ID と一致しない項目だけを残す
 */
export async function removeCustomCategoryUser (categoryId, userId) {
  const category = findCustomUserCategory(categoryId)
  const id = normalizeUserId(userId)
  if (!category || !id) {
    return
  }

  category.userIds = category.userIds.filter(user => user !== id)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ${category.label}ユーザー削除: @${id}`)
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
