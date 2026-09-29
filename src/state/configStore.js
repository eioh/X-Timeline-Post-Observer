import { EXPIRE_MS, STORAGE_KEYS } from '../constants.js'
import { configIndexes, rebuildConfigIndexes } from './configIndexes.js'
import { getConfigSummary } from './configSummary.js'
import { isNumericUserId, normalizeUserId } from '../utils/userIds.js'

const DEFAULT_CUSTOM_CATEGORY_COLOR = '#f5c542'
const AUTO_REPLACE_SAVE_DELAY_MS = 250
const PERSISTED_CONFIG_KEYS = [
  'mediaFilterLists',
  'hiddenUserIds',
  'followUserIds',
  'listUserIds',
  'customUserCategories',
  'hiddenWords',
  'hiddenStatuses',
  'hideUIEnabled',
  'autoRefreshEnabled'
]
const saveQueues = new Map()
const saveDebounceTimers = new Map()
const loggedUserIdReplacements = new Set()

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

  rebuildConfigIndexes(config)
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
  clearScheduledSaveKey(configKey)

  const previousSave = saveQueues.get(configKey) || Promise.resolve()
  const nextSave = previousSave
    .catch(error => {
      console.error(`[X-Observer] ${configKey} の前回保存に失敗しました:`, error)
    })
    .then(async () => {
      const storageKey = STORAGE_KEYS[configKey]
      await GM_setValues({ [storageKey]: config[configKey] })
    })

  saveQueues.set(configKey, nextSave)

  try {
    await nextSave
  } finally {
    if (saveQueues.get(configKey) === nextSave) {
      saveQueues.delete(configKey)
    }
  }
}

/**
 * 指定キーの遅延保存タイマーを取り消す。
 * 入力: config オブジェクト上のキー名。
 * 出力: なし。
 * 主な処理内容:
 * 1. 自動置換由来の保存予約を即時保存より前に消す
 */
function clearScheduledSaveKey (configKey) {
  const timer = saveDebounceTimers.get(configKey)
  if (!timer) return

  clearTimeout(timer)
  saveDebounceTimers.delete(configKey)
}

/**
 * 指定キーに対応する設定を少し遅らせて保存する。
 * 入力: config オブジェクト上のキー名。
 * 出力: なし。
 * 主な処理内容:
 * 1. 短時間に複数回起きる自動置換をキー単位でまとめる
 * 2. 実際の保存は saveKey の直列化レイヤーに委譲する
 */
function scheduleSaveKey (configKey) {
  if (!STORAGE_KEYS[configKey]) return

  clearScheduledSaveKey(configKey)
  const timer = setTimeout(() => {
    saveDebounceTimers.delete(configKey)
    void saveKey(configKey).catch(error => {
      console.error(`[X-Observer] ${configKey} の遅延保存に失敗しました:`, error)
    })
  }, AUTO_REPLACE_SAVE_DELAY_MS)

  saveDebounceTimers.set(configKey, timer)
}

/**
 * 永続化対象の全設定キーを保存する。
 * 入力: なし。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 予約済みの遅延保存を取り消す
 * 2. 各キーを saveKey の直列化レイヤーで保存する
 */
async function saveAllKeys () {
  await Promise.all(PERSISTED_CONFIG_KEYS.map(configKey => saveKey(configKey)))
}

/**
 * 予約中の遅延保存をすぐ保存キューへ流す。
 * 入力: なし。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 自動置換で予約された保存キーを取り出す
 * 2. タイマーを取り消して通常の saveKey で保存する
 */
export async function flushScheduledSaves () {
  const scheduledKeys = [...saveDebounceTimers.keys()]
  if (scheduledKeys.length === 0) {
    return
  }

  await Promise.all(scheduledKeys.map(configKey => saveKey(configKey)))
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

  await saveAllKeys()
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
 * ユーザー定義分類の配列位置を ID で探す。
 * 入力: 分類 ID。
 * 出力: 分類の index。見つからない場合は -1。
 * 主な処理内容:
 * 1. customUserCategories の現在順から優先順位に使う index を返す
 */
function findCustomUserCategoryIndex (categoryId) {
  return config.customUserCategories.findIndex(category => category.id === categoryId)
}

/**
 * ユーザー ID 配列に正規化後の一致値があるか判定する。
 * 入力: ユーザー ID 配列、正規化済み ID。
 * 出力: 一致する ID があれば true。
 * 主な処理内容:
 * 1. 保存済み値の表記ゆれを吸収して重複判定する
 */
function hasNormalizedUserId (userIds, normalizedUserId) {
  return userIds.some(userId => normalizeUserId(userId) === normalizedUserId)
}

/**
 * 指定した内部 ID が設定のどこかに残っているか判定する。
 * 入力: 正規化済み内部 ID。
 * 出力: 残っていれば true。
 * 主な処理内容:
 * 1. 単純リストの判定用 Set を確認する
 * 2. custom 分類の保存配列を正規化比較する
 */
function hasInternalUserIdAnywhere (normalizedInternalId) {
  if (!isNumericUserId(normalizedInternalId)) {
    return false
  }

  return (
    configIndexes.hiddenUserIds.has(normalizedInternalId) ||
    configIndexes.followUserIds.has(normalizedInternalId) ||
    configIndexes.listUserIds.has(normalizedInternalId) ||
    Boolean(
      configIndexes.customCategoryIndexesByInternalUserId.get(normalizedInternalId)
        ?.size
    )
  )
}

/**
 * 数字だけのユーザー ID を登録済み内部 ID インデックスへ追加する。
 * 入力: 正規化済みユーザー ID。
 * 出力: なし。
 * 主な処理内容: 数字 ID だけを置換候補インデックスへ入れる
 */
function addRegisteredInternalUserId (normalizedUserId) {
  if (isNumericUserId(normalizedUserId)) {
    configIndexes.registeredInternalUserIds.add(normalizedUserId)
  }
}

/**
 * custom 分類内の内部 ID 位置インデックスへ分類 index を追加する。
 * 入力: 正規化済み内部 ID、分類 index。
 * 出力: なし。
 * 主な処理内容:
 * 1. 数字 ID だけを対象にする
 * 2. 内部 ID が存在する分類 index を記録する
 */
function addCustomInternalUserIdIndex (normalizedUserId, categoryIndex) {
  if (!isNumericUserId(normalizedUserId)) {
    return
  }

  if (!configIndexes.customCategoryIndexesByInternalUserId.has(normalizedUserId)) {
    configIndexes.customCategoryIndexesByInternalUserId.set(normalizedUserId, new Set())
  }
  configIndexes.customCategoryIndexesByInternalUserId
    .get(normalizedUserId)
    .add(categoryIndex)
}

/**
 * custom 分類内の内部 ID 位置インデックスから分類 index を外す。
 * 入力: 正規化済み内部 ID、分類 index。
 * 出力: なし。
 * 主な処理内容:
 * 1. 指定分類に同じ内部 ID が残っていれば保持する
 * 2. 残っていなければ分類 index を削除する
 */
function removeCustomInternalUserIdIndex (normalizedUserId, categoryIndex) {
  if (!isNumericUserId(normalizedUserId)) {
    return
  }

  const category = config.customUserCategories[categoryIndex]
  const categoryIndexes =
    configIndexes.customCategoryIndexesByInternalUserId.get(normalizedUserId)
  if (!categoryIndexes || !category) {
    return
  }

  if (hasNormalizedUserId(category.userIds, normalizedUserId)) {
    return
  }

  categoryIndexes.delete(categoryIndex)
  if (categoryIndexes.size === 0) {
    configIndexes.customCategoryIndexesByInternalUserId.delete(normalizedUserId)
  }
}

/**
 * 登録済み内部 ID インデックスを現在設定に合わせて更新する。
 * 入力: 正規化済みユーザー ID。
 * 出力: なし。
 * 主な処理内容:
 * 1. 数字 ID 以外は無視する
 * 2. 設定内に残っていれば保持し、残っていなければ削除する
 */
function refreshRegisteredInternalUserId (normalizedUserId) {
  if (!isNumericUserId(normalizedUserId)) {
    return
  }

  if (hasInternalUserIdAnywhere(normalizedUserId)) {
    configIndexes.registeredInternalUserIds.add(normalizedUserId)
  } else {
    configIndexes.registeredInternalUserIds.delete(normalizedUserId)
  }
}

/**
 * custom 分類へ追加したユーザー ID を判定インデックスへ反映する。
 * 入力: 正規化済み ID、追加先分類 index。
 * 出力: なし。
 * 主な処理内容:
 * 1. 未登録または既存より前の分類なら Map を更新する
 * 2. custom 分類の配列順優先を維持する
 */
function addCustomCategoryUserIndex (normalizedUserId, categoryIndex) {
  const currentIndex = configIndexes.customUserCategoryIndexByUserId.get(normalizedUserId)
  if (currentIndex === undefined || categoryIndex < currentIndex) {
    configIndexes.customUserCategoryIndexByUserId.set(normalizedUserId, categoryIndex)
  }
}

/**
 * custom 分類から削除したユーザー ID を判定インデックスへ反映する。
 * 入力: 正規化済み ID、削除元分類 index。
 * 出力: なし。
 * 主な処理内容:
 * 1. 削除元が現在の優先分類でなければ Map を触らない
 * 2. 後続分類に同じ ID があれば次の優先先へ差し替える
 */
function removeCustomCategoryUserIndex (normalizedUserId, removedCategoryIndex) {
  if (
    configIndexes.customUserCategoryIndexByUserId.get(normalizedUserId) !==
    removedCategoryIndex
  ) {
    return
  }

  const nextCategoryIndex = config.customUserCategories.findIndex((category, index) =>
    index > removedCategoryIndex &&
    hasNormalizedUserId(category.userIds, normalizedUserId)
  )

  if (nextCategoryIndex >= 0) {
    configIndexes.customUserCategoryIndexByUserId.set(normalizedUserId, nextCategoryIndex)
    return
  }

  configIndexes.customUserCategoryIndexByUserId.delete(normalizedUserId)
}

/**
 * 内部 ID から screen name への置換後に custom 系インデックスを更新する。
 * 入力: 置換元の内部 ID、置換先の screen name。
 * 出力: なし。
 * 主な処理内容:
 * 1. custom 分類を一度だけ走査して双方の最小分類 index を探す
 * 2. custom Map と登録済み内部 ID Set を現在設定へ同期する
 */
function refreshUserIdReplacementIndexes (internalId, screenName) {
  const internalCategoryIndexes =
    configIndexes.customCategoryIndexesByInternalUserId.get(internalId)
  if (!internalCategoryIndexes || internalCategoryIndexes.size === 0) {
    configIndexes.customUserCategoryIndexByUserId.delete(internalId)
  } else {
    configIndexes.customUserCategoryIndexByUserId.set(
      internalId,
      Math.min(...internalCategoryIndexes)
    )
  }

  const screenNameCategoryIndex =
    configIndexes.customUserCategoryIndexByUserId.get(screenName)
  if (screenNameCategoryIndex !== undefined) {
    configIndexes.customUserCategoryIndexByUserId.set(
      screenName,
      screenNameCategoryIndex
    )
  }

  refreshRegisteredInternalUserId(internalId)
}

/**
 * ユーザー ID 配列内の内部 ID を screen name へ置換する。
 * 入力: ユーザー ID 配列、置換元内部 ID、置換先 screen name。
 * 出力: 変更後の配列と変更有無。
 * 主な処理内容:
 * 1. 同じ配列内に screen name があれば内部 ID を削除する
 * 2. 無ければ内部 ID を screen name へ置換する
 */
function replaceUserIdInList (userIds, internalId, screenName) {
  const hasScreenName = hasNormalizedUserId(userIds, screenName)
  let changed = false
  let didInsertScreenName = hasScreenName

  const nextUserIds = userIds
    .map(userId => {
      if (normalizeUserId(userId) !== internalId) {
        return userId
      }

      changed = true
      if (didInsertScreenName) {
        return null
      }

      didInsertScreenName = true
      return screenName
    })
    .filter(Boolean)

  return { userIds: nextUserIds, changed }
}

/**
 * 単純ユーザー ID リスト内の内部 ID を screen name へ置換する。
 * 入力: config キー、置換元内部 ID、置換先 screen name、変更 key Set。
 * 出力: なし。
 * 主な処理内容:
 * 1. 保存配列を置換する
 * 2. 対応する判定用 Set も差分更新する
 */
function replaceUserIdInConfigList (configKey, internalId, screenName, changedKeys) {
  const result = replaceUserIdInList(config[configKey], internalId, screenName)
  if (!result.changed) {
    return
  }

  config[configKey] = result.userIds
  configIndexes[configKey].delete(internalId)
  configIndexes[configKey].add(screenName)
  changedKeys.add(configKey)
}

/**
 * ユーザー定義分類内の内部 ID を screen name へ置換する。
 * 入力: 置換元内部 ID、置換先 screen name、変更 key Set。
 * 出力: なし。
 * 主な処理内容:
 * 1. 各分類内だけで重複を解消して置換する
 * 2. 別分類の重複は分類優先度維持のため残す
 */
function replaceUserIdInCustomCategories (internalId, screenName, changedKeys) {
  let changed = false
  const categoryIndexes = [
    ...(configIndexes.customCategoryIndexesByInternalUserId.get(internalId) || [])
  ]

  for (const categoryIndex of categoryIndexes) {
    const category = config.customUserCategories[categoryIndex]
    if (!category) {
      continue
    }

    const result = replaceUserIdInList(category.userIds, internalId, screenName)
    if (result.changed) {
      category.userIds = result.userIds
      removeCustomInternalUserIdIndex(internalId, categoryIndex)
      addCustomCategoryUserIndex(screenName, categoryIndex)
      changed = true
    }
  }

  if (changed) {
    changedKeys.add('customUserCategories')
  }
}

/**
 * 登録済み内部 ID を取得できた screen name へ置換する。
 * 入力: userId と userInternalId を持つ投稿情報。
 * 出力: 置換結果。変更が無ければ changed: false。
 * 主な処理内容:
 * 1. 登録済み内部 ID だけを対象にする
 * 2. 設定配列と判定用インデックスを差分更新する
 * 3. 変更された保存キーだけ遅延保存する
 */
export function replaceKnownInternalUserIdWithScreenName (postInfo) {
  const internalId = normalizeUserId(postInfo?.userInternalId)
  const screenName = normalizeUserId(postInfo?.userId)

  if (
    !isNumericUserId(internalId) ||
    !screenName ||
    isNumericUserId(screenName) ||
    !configIndexes.registeredInternalUserIds.has(internalId)
  ) {
    return { changed: false, keys: [] }
  }

  const changedKeys = new Set()
  replaceUserIdInConfigList('hiddenUserIds', internalId, screenName, changedKeys)
  replaceUserIdInConfigList('followUserIds', internalId, screenName, changedKeys)
  replaceUserIdInConfigList('listUserIds', internalId, screenName, changedKeys)
  replaceUserIdInCustomCategories(internalId, screenName, changedKeys)

  if (changedKeys.size === 0) {
    refreshRegisteredInternalUserId(internalId)
    return { changed: false, keys: [] }
  }

  refreshUserIdReplacementIndexes(internalId, screenName)

  const shouldDebounceSave = changedKeys.has('customUserCategories')
  for (const configKey of changedKeys) {
    if (shouldDebounceSave) {
      scheduleSaveKey(configKey)
    } else {
      void saveKey(configKey).catch(error => {
        console.error(`[X-Observer] ${configKey} の自動置換保存に失敗しました:`, error)
      })
    }
  }

  const logKey = `${internalId}->${screenName}`
  if (!loggedUserIdReplacements.has(logKey)) {
    loggedUserIdReplacements.add(logKey)
    console.log('[X-Observer] ユーザーIDをscreen nameへ置換しました:', {
      from: internalId,
      to: screenName,
      keys: [...changedKeys]
    })
  }

  return {
    changed: true,
    keys: [...changedKeys]
  }
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
  const userIdSet = configIndexes[configKey]
  if (!id || !userIdSet || userIdSet.has(id)) {
    return false
  }

  config[configKey].push(id)
  userIdSet.add(id)
  addRegisteredInternalUserId(id)
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
  if (id && !configIndexes.hiddenUserIds.has(id)) {
    config.hiddenUserIds.push(id)
    configIndexes.hiddenUserIds.add(id)
    addRegisteredInternalUserId(id)
    await saveKey('hiddenUserIds')
    console.log(`[X-Observer] 非表示ユーザー追加: @${id}`)
  }
}

/** 非表示ユーザーを削除する。*/
export async function removeHiddenUser (userId) {
  const id = normalizeUserId(userId)
  config.hiddenUserIds = config.hiddenUserIds.filter(
    user => normalizeUserId(user) !== id
  )
  configIndexes.hiddenUserIds.delete(id)
  refreshRegisteredInternalUserId(id)
  await saveKey('hiddenUserIds')
  console.log(`[X-Observer] 非表示ユーザー削除: @${id}`)
}

/**
 * 非表示ユーザーをすべて削除する。
 * 入力: なし。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 配列と判定用 Set を一度で空にする
 * 2. ストレージ保存も一度だけ行う
 */
export async function clearHiddenUsers () {
  config.hiddenUserIds = []
  configIndexes.hiddenUserIds.clear()
  rebuildConfigIndexes(config)
  await saveKey('hiddenUserIds')
  console.log('[X-Observer] 非表示ユーザーをすべて削除しました')
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
  if (id && !configIndexes.followUserIds.has(id)) {
    config.followUserIds.push(id)
    configIndexes.followUserIds.add(id)
    addRegisteredInternalUserId(id)
    await saveKey('followUserIds')
    console.log(`[X-Observer] フォローユーザー追加: @${id}`)
  }
}

/** フォローユーザーを削除する。*/
export async function removeFollowUser (userId) {
  const id = normalizeUserId(userId)
  config.followUserIds = config.followUserIds.filter(
    user => normalizeUserId(user) !== id
  )
  configIndexes.followUserIds.delete(id)
  refreshRegisteredInternalUserId(id)
  await saveKey('followUserIds')
  console.log(`[X-Observer] フォローユーザー削除: @${id}`)
}

/**
 * フォローユーザーをすべて削除する。
 * 入力: なし。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 配列と判定用 Set を一度で空にする
 * 2. ストレージ保存も一度だけ行う
 */
export async function clearFollowUsers () {
  config.followUserIds = []
  configIndexes.followUserIds.clear()
  rebuildConfigIndexes(config)
  await saveKey('followUserIds')
  console.log('[X-Observer] フォローユーザーをすべて削除しました')
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
  if (id && !configIndexes.listUserIds.has(id)) {
    config.listUserIds.push(id)
    configIndexes.listUserIds.add(id)
    addRegisteredInternalUserId(id)
    await saveKey('listUserIds')
    console.log(`[X-Observer] リストインユーザー追加: @${id}`)
  }
}

/** リストインユーザーを削除する。*/
export async function removeListUser (userId) {
  const id = normalizeUserId(userId)
  config.listUserIds = config.listUserIds.filter(
    user => normalizeUserId(user) !== id
  )
  configIndexes.listUserIds.delete(id)
  refreshRegisteredInternalUserId(id)
  await saveKey('listUserIds')
  console.log(`[X-Observer] リストインユーザー削除: @${id}`)
}

/**
 * リストインユーザーをすべて削除する。
 * 入力: なし。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 配列と判定用 Set を一度で空にする
 * 2. ストレージ保存も一度だけ行う
 */
export async function clearListUsers () {
  config.listUserIds = []
  configIndexes.listUserIds.clear()
  rebuildConfigIndexes(config)
  await saveKey('listUserIds')
  console.log('[X-Observer] リストインユーザーをすべて削除しました')
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
  rebuildConfigIndexes(config)
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
  const categoryIndex = findCustomUserCategoryIndex(categoryId)
  const category = config.customUserCategories[categoryIndex]
  const id = normalizeUserId(userId)
  if (!category || !id || hasNormalizedUserId(category.userIds, id)) {
    return
  }

  category.userIds.push(id)
  addCustomCategoryUserIndex(id, categoryIndex)
  addCustomInternalUserIdIndex(id, categoryIndex)
  addRegisteredInternalUserId(id)
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
  const categoryIndex = findCustomUserCategoryIndex(categoryId)
  const category = config.customUserCategories[categoryIndex]
  const id = normalizeUserId(userId)
  if (!category || !id) {
    return
  }

  category.userIds = category.userIds.filter(user => normalizeUserId(user) !== id)
  removeCustomCategoryUserIndex(id, categoryIndex)
  removeCustomInternalUserIdIndex(id, categoryIndex)
  refreshRegisteredInternalUserId(id)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ${category.label}ユーザー削除: @${id}`)
}

/**
 * ユーザー定義分類から全ユーザー ID を削除する。
 * 入力: 分類 ID。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. 対象分類の userIds を一度で空にする
 * 2. custom 分類インデックスを一度だけ再構築して保存する
 */
export async function clearCustomCategoryUsers (categoryId) {
  const category = findCustomUserCategory(categoryId)
  if (!category) {
    return
  }

  category.userIds = []
  rebuildConfigIndexes(config)
  await saveKey('customUserCategories')
  console.log(`[X-Observer] ${category.label}ユーザーをすべて削除しました`)
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

/**
 * 現在の設定をログへ表示する。
 * 入力: full を true にすると全設定を表示するオプション。
 * 出力: なし。
 * 主な処理内容:
 * 1. 通常は巨大配列を含まない件数サマリを表示する
 * 2. 明示指定時だけ従来どおり全設定を表示する
 */
export function showConfig ({ full = false } = {}) {
  console.log(
    '[X-Observer] 現在の設定:',
    full ? JSON.parse(JSON.stringify(config)) : getConfigSummary(config)
  )
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
