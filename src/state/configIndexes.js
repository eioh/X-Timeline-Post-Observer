import { normalizeUserId } from '../utils/userIds.js'

// 判定用の派生インデックスを保持する。保存形式は config 側の配列を正とする。
export const configIndexes = {
  hiddenUserIds: new Set(),
  followUserIds: new Set(),
  listUserIds: new Set(),
  customUserCategoryIndexByUserId: new Map()
}

/**
 * ユーザー ID 配列から判定用 Set を作る。
 * 入力: 保存中のユーザー ID 配列。
 * 出力: 正規化済みユーザー ID の Set。
 * 主な処理内容:
 * 1. 保存済み値を比較用に正規化する
 * 2. 空値を除いて判定時にそのまま has できる形へ変換する
 */
function createUserIdSet (userIds) {
  return new Set(
    userIds
      .map(userId => normalizeUserId(userId))
      .filter(Boolean)
  )
}

/**
 * 設定全体から判定用インデックスを再構築する。
 * 入力: 現在の config オブジェクト。
 * 出力: なし。
 * 主な処理内容:
 * 1. 配列保存されたユーザー ID を Set / Map へ変換する
 * 2. custom 分類は分類配列の先勝ち優先を維持して userId から分類 index を引けるようにする
 */
export function rebuildConfigIndexes (config) {
  configIndexes.hiddenUserIds = createUserIdSet(config.hiddenUserIds)
  configIndexes.followUserIds = createUserIdSet(config.followUserIds)
  configIndexes.listUserIds = createUserIdSet(config.listUserIds)
  configIndexes.customUserCategoryIndexByUserId = new Map()

  config.customUserCategories.forEach((category, categoryIndex) => {
    for (const userId of category.userIds) {
      const normalizedUserId = normalizeUserId(userId)
      if (
        normalizedUserId &&
        !configIndexes.customUserCategoryIndexByUserId.has(normalizedUserId)
      ) {
        configIndexes.customUserCategoryIndexByUserId.set(
          normalizedUserId,
          categoryIndex
        )
      }
    }
  })
}
