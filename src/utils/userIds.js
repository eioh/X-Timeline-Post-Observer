/**
 * ユーザー ID を保存用の書式へ正規化する。
 * 入力: @ の有無どちらでもよいユーザー ID。
 * 出力: 先頭の @ を除去したユーザー ID。
 * 主な処理内容:
 * 1. 手入力と自動取得で形式を揃える
 * 2. 数字だけの内部 ID も文字列として同じ配列へ保存できるようにする
 */
export function normalizeUserId (userId) {
  return String(userId || '').trim().replace(/^@+/, '')
}

/**
 * 投稿情報からユーザー判定に使う ID 候補を返す。
 * 入力: 抽出済み投稿情報または引用投稿情報。
 * 出力: 重複を除いたユーザー ID 候補配列。
 * 主な処理内容:
 * 1. 画面表示の @userId と内部数字 ID を同列の候補にする
 * 2. 空値と重複を取り除く
 */
export function getUserIdCandidates (postInfo) {
  return [
    ...new Set(
      [postInfo?.userId, postInfo?.userInternalId]
        .map(userId => normalizeUserId(userId))
        .filter(Boolean)
    )
  ]
}

/**
 * ユーザー ID 候補のいずれかが設定リストに含まれるか判定する。
 * 入力: ユーザー ID 候補配列、設定済みユーザー ID 配列または正規化済み Set。
 * 出力: 一致したユーザー ID。無ければ null。
 * 主な処理内容:
 * 1. Set は configIndexes 由来の正規化済みデータとしてそのまま使う
 * 2. 配列は登録値も比較用に正規化する
 * 3. スクリーン名と内部数字 ID のどちらでも一致できるようにする
 */
export function findMatchingUserId (candidates, registeredUserIds) {
  if (registeredUserIds instanceof Set) {
    return candidates.find(userId => registeredUserIds.has(userId)) ?? null
  }

  const normalizedRegistered = new Set(
    registeredUserIds
      .map(userId => normalizeUserId(userId))
      .filter(Boolean)
  )

  return candidates.find(userId => normalizedRegistered.has(userId)) ?? null
}
