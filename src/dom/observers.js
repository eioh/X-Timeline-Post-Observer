import { PROCESSED_ATTR } from '../constants.js'

/**
 * タイムラインの DOM 変化を監視して再処理をつなぐ。
 * 入力: scheduleProcess と handleLateMedia を持つオブジェクト
 * 出力: MutationObserver
 * 主な処理内容:
 * 1. 新しい article 追加を検知する
 * 2. 処理済み article 内の遅延メディア追加を検知する
 * 3. 必要な再処理だけを呼び出す
 */
export function setupTimelineObserver ({ scheduleProcess, handleLateMedia }) {
  const observer = new MutationObserver(mutations => {
    let hasNewArticle = false

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue

        // article 追加は直接ノードだけでなく、追加 subtree 内にも現れるため querySelector で拾う。
        if (node.querySelector && node.querySelector('article')) {
          hasNewArticle = true
        }

        // 画像・動画は article 本体より遅れて差し込まれるため、メディア要素追加も独立に拾う。
        const mediaNodes = []
        if (
          node.getAttribute &&
          (node.getAttribute('data-testid') === 'tweetPhoto' ||
            node.getAttribute('data-testid') === 'videoPlayer' ||
            node.getAttribute('data-testid') === 'videoComponent')
        ) {
          mediaNodes.push(node)
        }
        if (node.querySelectorAll) {
          mediaNodes.push(
            ...node.querySelectorAll(
              '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
            )
          )
        }

        for (const media of mediaNodes) {
          const article = media.closest('article')
          if (article && article.hasAttribute(PROCESSED_ATTR)) {
            handleLateMedia(article)
          }
        }
      }
    }

    if (hasNewArticle) {
      scheduleProcess()
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })

  return observer
}
