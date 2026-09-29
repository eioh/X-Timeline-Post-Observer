import { config } from '../state/configStore.js'
import { applyUserLabelsFromDom } from './userLabelColors.js'

const LABEL_PROCESSED_ATTR = 'data-xtlo-label-processed'

/**
 * DOM 上の article へユーザー分類色だけを反映する制御オブジェクトを作る。
 * 入力: なし。
 * 出力: processNewArticles / reapplyUserLabels / scheduleProcess / start を持つオブジェクト。
 * 主な処理内容:
 * 1. React 内部データや非表示判定を使わず、表示済み article の @userId だけを着色する
 * 2. MutationObserver の多発を requestAnimationFrame でまとめる
 * 3. 設定変更時は既存 article の分類色だけを再適用する
 */
export function createUserLabelObserver () {
  let pendingRAF = false
  let observer = null

  /**
   * 未処理 article へ分類色を反映する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 未処理 article だけを対象にする
   * 2. 投稿の非表示や X の内部データ参照は行わず、分類色だけを付ける
   */
  function processNewArticles () {
    const articles = document.querySelectorAll(`article:not([${LABEL_PROCESSED_ATTR}])`)
    articles.forEach(article => {
      article.setAttribute(LABEL_PROCESSED_ATTR, 'true')
      applyUserLabelsFromDom(article, config)
    })
  }

  /**
   * 既存 article へ分類色を再適用する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定変更後に分類色のクラスだけを更新する
   * 2. display やスクロール位置に影響する非表示処理は呼ばない
   */
  function reapplyUserLabels () {
    const articles = document.querySelectorAll(`article[${LABEL_PROCESSED_ATTR}]`)
    articles.forEach(article => {
      applyUserLabelsFromDom(article, config)
    })
    console.log(`[X-Observer] 安全モード: ${articles.length} 件のユーザー分類色を再適用しました`)
  }

  /**
   * 新規 article 処理を次の描画タイミングへまとめて予約する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容: DOM 変化が連続しても分類色処理を 1 フレームにまとめる
   */
  function scheduleProcess () {
    if (pendingRAF) return
    pendingRAF = true
    requestAnimationFrame(() => {
      pendingRAF = false
      processNewArticles()
    })
  }

  /**
   * article 追加だけを監視してユーザー分類色を反映する。
   * 入力: なし。
   * 出力: MutationObserver。
   * 主な処理内容:
   * 1. タイムラインの追加読込を誘発しないようクリックやスクロール操作は行わない
   * 2. 追加された article を検知した場合だけ分類色処理を予約する
   */
  function start () {
    if (observer) return observer

    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue

          if (
            (node.matches && node.matches('article')) ||
            (node.querySelector && node.querySelector('article'))
          ) {
            scheduleProcess()
            return
          }
        }
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true
    })

    return observer
  }

  return {
    processNewArticles,
    reapplyUserLabels,
    scheduleProcess,
    start
  }
}
