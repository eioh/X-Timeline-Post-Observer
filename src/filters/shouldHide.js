import { findMatchingUserId, getUserIdCandidates } from '../utils/userIds.js'

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
export function shouldHide (tabName, postInfo, config) {
  // リスト単位のメディアフィルタは「表示条件」であり、他の非表示条件より先に判定すると意図が追いやすい。
  if (
    tabName &&
    config.mediaFilterLists.includes(tabName) &&
    !postInfo.hasMedia
  ) {
    return `media-filter (list: ${tabName})`
  }

  const hiddenUserId = findMatchingUserId(
    getUserIdCandidates(postInfo),
    config.hiddenUserIds
  )
  if (hiddenUserId) {
    return `hidden-user (${hiddenUserId})`
  }

  if (
    postInfo.statusId &&
    config.hiddenStatuses.some(entry => entry.statusId === postInfo.statusId)
  ) {
    return `hidden-status (${postInfo.statusId})`
  }

  if (postInfo.text) {
    // 登録時の表記をそのまま残したいので、保存値は変えずに比較時だけ小文字へ揃える。
    const normalizedPostText = normalizeTextForCaseInsensitiveMatch(postInfo.text)

    for (const word of config.hiddenWords) {
      if (normalizedPostText.includes(normalizeTextForCaseInsensitiveMatch(word))) {
        return `hidden-word ("${word}")`
      }
    }
  }

  return null
}
