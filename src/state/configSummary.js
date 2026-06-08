/**
 * 設定内容をログ向けの件数サマリへ変換する。
 * 入力: 現在の config オブジェクト。
 * 出力: 巨大配列を含まないサマリオブジェクト。
 * 主な処理内容:
 * 1. 大きなユーザー ID 配列は件数だけにする
 * 2. custom 分類は分類ごとの件数を残して状態確認に使えるようにする
 */
export function getConfigSummary (config) {
  return {
    mediaFilterLists: config.mediaFilterLists.length,
    hiddenUserIds: config.hiddenUserIds.length,
    followUserIds: config.followUserIds.length,
    listUserIds: config.listUserIds.length,
    customUserCategories: config.customUserCategories.map(category => ({
      id: category.id,
      label: category.label,
      color: category.color,
      userIds: category.userIds.length
    })),
    hiddenWords: config.hiddenWords.length,
    hiddenStatuses: config.hiddenStatuses.length,
    hideUIEnabled: config.hideUIEnabled,
    autoRefreshEnabled: config.autoRefreshEnabled
  }
}
