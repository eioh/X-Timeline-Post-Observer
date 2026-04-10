import { HIDDEN_ATTR } from '../constants.js'

/**
 * 仮想スクロール用セルを article から逆引きする。
 * 入力: article 要素
 * 出力: position:absolute の祖先要素。見つからない場合は null
 * 主な処理内容: 親を数段さかのぼり、X の仮想リストセルを見つける
 */
function getCellDiv (article) {
  let element = article

  for (let i = 0; i < 6; i++) {
    element = element.parentElement
    if (!element) return null
    if (element.style && element.style.position === 'absolute') return element
  }

  return null
}

/**
 * 投稿セルごと非表示にする。
 * 入力: article 要素、非表示理由
 * 出力: なし
 * 主な処理内容: 仮想スクロールの空白を防ぐため、article ではなく祖先セルを隠す
 */
export function hideArticle (article, reason) {
  const cellDiv = getCellDiv(article)
  if (cellDiv) {
    cellDiv.style.display = 'none'
  }
  article.setAttribute(HIDDEN_ATTR, reason)
}

/**
 * 非表示にしていた投稿セルを再表示する。
 * 入力: article 要素
 * 出力: なし
 * 主な処理内容: 祖先セルの display と data 属性を元に戻す
 */
export function unhideArticle (article) {
  const cellDiv = getCellDiv(article)
  if (cellDiv) {
    cellDiv.style.display = ''
  }
  article.removeAttribute(HIDDEN_ATTR)
}
