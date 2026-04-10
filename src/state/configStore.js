import { EXPIRE_MS, STORAGE_KEYS } from '../constants.js'

// 現在設定の単一参照元。
// オブジェクト自体を差し替えずに中身だけ更新することで、各モジュールの参照を維持する。
export const config = {
  mediaFilterLists: [],
  hiddenUserIds: [],
  hiddenWords: [],
  hiddenStatuses: []
}

/**
 * 設定オブジェクトの中身を既存参照を保ったまま更新する。
 * 入力: 次に保持したい設定オブジェクト
 * 出力: なし
 * 主な処理内容: 各配列を config に再代入し、他モジュールの参照切れを防ぐ
 */
function assignConfig (nextConfig) {
  config.mediaFilterLists = nextConfig.mediaFilterLists
  config.hiddenUserIds = nextConfig.hiddenUserIds
  config.hiddenWords = nextConfig.hiddenWords
  config.hiddenStatuses = nextConfig.hiddenStatuses
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
export async function loadConfig () {
  const stored = await GM_getValues({
    [STORAGE_KEYS.mediaFilterLists]: [],
    [STORAGE_KEYS.hiddenUserIds]: [],
    [STORAGE_KEYS.hiddenWords]: [],
    [STORAGE_KEYS.hiddenStatuses]: []
  })

  assignConfig({
    mediaFilterLists: stored[STORAGE_KEYS.mediaFilterLists],
    hiddenUserIds: stored[STORAGE_KEYS.hiddenUserIds],
    hiddenWords: stored[STORAGE_KEYS.hiddenWords],
    hiddenStatuses: stored[STORAGE_KEYS.hiddenStatuses]
  })

  // 起動時に期限切れを掃除しておくことで、判定側が毎回「有効期限」を気にせずに済む。
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
 * 入力: config オブジェクト上のキー名
 * 出力: Promise<void>
 * 主な処理内容: キー名を Tampermonkey ストレージキーへ引き直して保存する
 */
export async function saveKey (configKey) {
  const storageKey = STORAGE_KEYS[configKey]
  await GM_setValues({ [storageKey]: config[configKey] })
}

/**
 * 新しい設定一式で保存内容を丸ごと置き換える。
 * 入力: 正規化済み設定オブジェクト
 * 出力: Promise<void>
 * 主な処理内容: メモリ上の config とストレージを同じ内容へ一括で同期する
 */
export async function replaceConfig (nextConfig) {
  assignConfig({
    mediaFilterLists: nextConfig.mediaFilterLists,
    hiddenUserIds: nextConfig.hiddenUserIds,
    hiddenWords: nextConfig.hiddenWords,
    hiddenStatuses: nextConfig.hiddenStatuses
  })

  await GM_setValues({
    [STORAGE_KEYS.mediaFilterLists]: config.mediaFilterLists,
    [STORAGE_KEYS.hiddenUserIds]: config.hiddenUserIds,
    [STORAGE_KEYS.hiddenWords]: config.hiddenWords,
    [STORAGE_KEYS.hiddenStatuses]: config.hiddenStatuses
  })
}

/** メディアフィルタ対象リスト名を追加する。 */
export async function addMediaFilterList (listName) {
  if (!config.mediaFilterLists.includes(listName)) {
    config.mediaFilterLists.push(listName)
    await saveKey('mediaFilterLists')
    console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`)
  }
}

/** メディアフィルタ対象リスト名を削除する。 */
export async function removeMediaFilterList (listName) {
  config.mediaFilterLists = config.mediaFilterLists.filter(n => n !== listName)
  await saveKey('mediaFilterLists')
  console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`)
}

/**
 * 非表示ユーザーを追加する。
 * 入力: @ の有無どちらでもよいユーザー ID
 * 出力: Promise<void>
 * 主な処理内容: 保存形式を揃えるため、先頭の @ を除去してから重複チェックする
 */
export async function addHiddenUser (userId) {
  const id = userId.replace(/^@/, '')
  if (!config.hiddenUserIds.includes(id)) {
    config.hiddenUserIds.push(id)
    await saveKey('hiddenUserIds')
    console.log(`[X-Observer] 非表示ユーザー追加: @${id}`)
  }
}

/** 非表示ユーザーを削除する。 */
export async function removeHiddenUser (userId) {
  const id = userId.replace(/^@/, '')
  config.hiddenUserIds = config.hiddenUserIds.filter(user => user !== id)
  await saveKey('hiddenUserIds')
  console.log(`[X-Observer] 非表示ユーザー削除: @${id}`)
}

/**
 * 非表示キーワードを追加する。
 * 入力: 保存したいキーワード文字列
 * 出力: Promise<void>
 * 主な処理内容: 登録時の表記は維持しつつ、重複判定だけ大文字小文字を無視して行う
 */
export async function addHiddenWord (word) {
  // 判定時は大文字小文字を無視する仕様なので、登録時の重複判定も同じ条件へ揃える。
  const normalizedWord = word.toLowerCase()

  if (!config.hiddenWords.some(item => item.toLowerCase() === normalizedWord)) {
    config.hiddenWords.push(word)
    await saveKey('hiddenWords')
    console.log(`[X-Observer] 非表示ワード追加: "${word}"`)
  }
}

/** 非表示キーワードを削除する。 */
export async function removeHiddenWord (word) {
  config.hiddenWords = config.hiddenWords.filter(item => item !== word)
  await saveKey('hiddenWords')
  console.log(`[X-Observer] 非表示ワード削除: "${word}"`)
}

/**
 * 非表示投稿を期限つきで追加する。
 * 入力: 数値文字列の statusId
 * 出力: Promise<void>
 * 主な処理内容: 重複登録を避けつつ、有効期限を付けて保存する
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

/** 非表示投稿を削除する。 */
export async function removeHiddenStatus (statusId) {
  config.hiddenStatuses = config.hiddenStatuses.filter(
    entry => entry.statusId !== statusId
  )
  await saveKey('hiddenStatuses')
  console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`)
}

/** 現在設定をログへ安全に表示する。 */
export function showConfig () {
  console.log('[X-Observer] 現在の設定:', JSON.parse(JSON.stringify(config)))
}
