/**
 * 投稿情報と現在設定から、非表示にすべき理由を返す。
 * 入力: タブ名、抽出済み投稿情報、現在設定
 * 出力: 非表示理由の文字列。表示対象なら null
 * 主な処理内容: メディアフィルタ、ユーザー、投稿 ID、キーワードの順で判定する
 */
export function shouldHide (tabName, postInfo, config) {
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
