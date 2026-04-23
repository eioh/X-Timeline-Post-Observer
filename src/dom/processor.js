import { HIDDEN_ATTR, PROCESSED_ATTR } from '../constants.js'
import {
  extractPostInfo,
  getActiveTabName,
  isHomeTimelinePage
} from '../extractors/postExtractor.js'
import { applyUserLabelsToArticle } from '../features/userLabelColors.js'
import { shouldHide } from '../filters/shouldHide.js'
import { config, learnClassifiedUserFromTab } from '../state/configStore.js'
import { hideArticle, unhideArticle } from './articleVisibility.js'

/**
 * タイムライン処理本体をまとめたオブジェクトを生成する。
 * 入力: なし
 * 出力: 新規投稿処理、再判定、再適用、スケジュール実行の各関数
 * 主な処理内容: requestAnimationFrame の保留状態も含めて、投稿処理の状態を閉じ込める
 */
export function createProcessor () {
  let pendingRAF = false

  /**
   * 未処理 article を走査して初回判定を行う。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: 未処理 article に印を付け、情報抽出後に非表示判定を行う
   */
  function processNewArticles () {
    const articles = document.querySelectorAll(`article:not([${PROCESSED_ATTR}])`)
    if (articles.length === 0) return

    const tabName = getActiveTabName()
    const shouldLearnClassifiedUser = isHomeTimelinePage()
    let didLearnClassifiedUser = false

    articles.forEach(article => {
      article.setAttribute(PROCESSED_ATTR, 'true')

      const info = extractPostInfo(article)
      if (
        shouldLearnClassifiedUser &&
        learnClassifiedUserFromTab(tabName, info.userId, info.isRepost)
      ) {
        didLearnClassifiedUser = true
      }
      applyUserLabelsToArticle(article, info, config)
      if (!info.statusId) return

      console.log('[X-Observer]', { tab: tabName, ...info })

      const hideReason = shouldHide(tabName, info, config)
      if (hideReason) {
        hideArticle(article, hideReason)
        console.log(`[X-Observer] 非表示: ${hideReason}`, info.statusId)
      }
    })

    if (didLearnClassifiedUser) {
      reapplyFilters()
    }
  }

  /**
   * 遅れて読み込まれたメディアを踏まえて再判定する。
   * 入力: 既に処理済みの article 要素
   * 出力: なし
   * 主な処理内容: メディア有無が後から変わるケースに限定して表示状態を更新する
   */
  function handleLateMedia (article) {
    const tabName = getActiveTabName()
    const info = extractPostInfo(article)
    applyUserLabelsToArticle(article, info, config)
    if (!info.statusId) return

    console.log('[X-Observer] メディア遅延検出、再判定:', {
      tab: tabName,
      ...info
    })

    const hideReason = shouldHide(tabName, info, config)
    const currentlyHidden = article.hasAttribute(HIDDEN_ATTR)

    if (hideReason && !currentlyHidden) {
      hideArticle(article, hideReason)
    } else if (!hideReason && currentlyHidden) {
      unhideArticle(article)
    }
  }

  /**
   * 既に表示済みの投稿すべてへ現在設定を再適用する。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: 設定変更後に hidden / shown の差分だけを反映する
   */
  function reapplyFilters () {
    const tabName = getActiveTabName()
    const articles = document.querySelectorAll(`article[${PROCESSED_ATTR}]`)
    let hiddenCount = 0
    let shownCount = 0

    articles.forEach(article => {
      const info = extractPostInfo(article)
      applyUserLabelsToArticle(article, info, config)
      if (!info.statusId) return

      const hideReason = shouldHide(tabName, info, config)
      const currentlyHidden = article.hasAttribute(HIDDEN_ATTR)

      if (hideReason && !currentlyHidden) {
        hideArticle(article, hideReason)
        hiddenCount++
      } else if (!hideReason && currentlyHidden) {
        unhideArticle(article)
        shownCount++
      }
    })

    console.log(
      `[X-Observer] フィルタ再適用: ${hiddenCount} 件非表示, ${shownCount} 件再表示`
    )
  }

  /**
   * 新規投稿処理を次の描画タイミングへまとめて予約する。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: MutationObserver 多発時の重複実行を pendingRAF で抑制する
   */
  function scheduleProcess () {
    if (pendingRAF) return
    pendingRAF = true
    requestAnimationFrame(() => {
      pendingRAF = false
      processNewArticles()
    })
  }

  return {
    processNewArticles,
    handleLateMedia,
    reapplyFilters,
    scheduleProcess
  }
}
