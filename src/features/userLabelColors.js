const FOLLOW_LABEL_CLASS = 'xtlo-user-label-follow'
const LIST_LABEL_CLASS = 'xtlo-user-label-list'
const USER_LABEL_CSS = `
  .${FOLLOW_LABEL_CLASS} {
    color: #1d9bf0 !important;
  }

  .${LIST_LABEL_CLASS} {
    color: #33c46a !important;
  }
`

let styleInjected = false

/**
 * ユーザー分類ラベル用のスタイルを一度だけ挿入する。
 * 入力: なし
 * 出力: なし
 * 主な処理内容:
 * 1. フォロー用とリストイン用の色を定義する
 * 2. 多重挿入を防ぐ
 */
export function applyUserLabelStyles () {
  if (styleInjected) return

  GM_addStyle(USER_LABEL_CSS)
  styleInjected = true
}

/**
 * 設定から対象ユーザーの色分類を返す。
 * 入力: ユーザー ID、現在設定
 * 出力: follow / list / null
 * 主な処理内容:
 * 1. フォロー分類を最優先する
 * 2. どちらにも無い場合は null を返す
 */
function getUserLabelType (userId, config) {
  if (!userId) return null

  if (config.followUserIds.includes(userId)) {
    return 'follow'
  }

  if (config.listUserIds.includes(userId)) {
    return 'list'
  }

  return null
}

/**
 * プロフィール系リンクかどうかを userId 基準で判定する。
 * 入力: href 文字列、対象 userId
 * 出力: 一致時 true
 * 主な処理内容:
 * 1. /<userId> または /<userId>/status/... を受け入れる
 * 2. クエリやハッシュ付きリンクも拾う
 */
function isUserProfileLink (href, userId) {
  return (
    href === `/${userId}` ||
    href.startsWith(`/${userId}/`) ||
    href.startsWith(`/${userId}?`) ||
    href.startsWith(`/${userId}#`)
  )
}

/**
 * ユーザー ID 表示用の span をリンク内から探す。
 * 入力: プロフィールリンク要素、対象 userId
 * 出力: マッチした span 要素、無ければ null
 * 主な処理内容:
 * 1. @userId と完全一致する表示だけを対象にする
 * 2. displayName 側を誤って着色しない
 */
function findUserIdSpan (link, userId) {
  const expectedText = `@${userId}`
  const spans = link.querySelectorAll('span')

  for (const span of spans) {
    const text = span.textContent?.trim().replace(/\u200b/g, '')
    if (text === expectedText) {
      return span
    }
  }

  return null
}

/**
 * コンテナ内の既存分類クラスを除去する。
 * 入力: article または引用カードの要素
 * 出力: なし
 * 主な処理内容:
 * 1. 再適用時に古い色が残らないようクラスを外す
 */
function clearUserLabelClasses (container) {
  container
    .querySelectorAll(`.${FOLLOW_LABEL_CLASS}, .${LIST_LABEL_CLASS}`)
    .forEach(element => {
      element.classList.remove(FOLLOW_LABEL_CLASS, LIST_LABEL_CLASS)
    })
}

/**
 * 対象コンテナ内で特定ユーザーの @userId 表示へ色分類を反映する。
 * 入力: 描画対象コンテナ、ユーザー ID、分類
 * 出力: なし
 * 主な処理内容:
 * 1. 対応するプロフィールリンクを探す
 * 2. @userId 表示用 span へ分類クラスを付ける
 */
function applyLabelToUserInContainer (container, userId, labelType) {
  if (!userId || !labelType) return

  const className =
    labelType === 'follow' ? FOLLOW_LABEL_CLASS : LIST_LABEL_CLASS
  const links = container.querySelectorAll('a[href^="/"]')

  for (const link of links) {
    const href = link.getAttribute('href') || ''
    if (!isUserProfileLink(href, userId)) {
      continue
    }

    const userIdSpan = findUserIdSpan(link, userId)
    if (userIdSpan) {
      userIdSpan.classList.add(className)
    }
  }
}

/**
 * 投稿内のユーザー ID 表示へ分類色を反映する。
 * 入力: article 要素、抽出済み投稿情報、現在設定
 * 出力: なし
 * 主な処理内容:
 * 1. 既存の色クラスを消してから再適用する
 * 2. 本文側と引用側それぞれの userId を個別に着色する
 */
export function applyUserLabelsToArticle (article, postInfo, config) {
  clearUserLabelClasses(article)

  const quoteContainer = article.querySelector('div[role="link"][tabindex="0"]')
  if (quoteContainer) {
    clearUserLabelClasses(quoteContainer)
  }

  const mainLabelType = getUserLabelType(postInfo.userId, config)
  applyLabelToUserInContainer(article, postInfo.userId, mainLabelType)

  if (!quoteContainer || !postInfo.quote?.userId) {
    return
  }

  const quoteLabelType = getUserLabelType(postInfo.quote.userId, config)
  applyLabelToUserInContainer(quoteContainer, postInfo.quote.userId, quoteLabelType)
}
