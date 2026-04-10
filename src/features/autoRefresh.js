import { AUTO_REFRESH_INTERVAL, SCROLL_TOP_THRESHOLD } from '../constants.js'

/**
 * 新着投稿自動読込の制御オブジェクトを生成する。
 * 入力: なし
 * 出力: start / stop / toggle を持つオブジェクト
 * 主な処理内容: interval と有効フラグを閉じ込め、外部からは制御関数だけを公開する
 */
export function createAutoRefreshController () {
  let autoRefreshEnabled = true
  let autoRefreshTimer = null

  /** 「新しいポストを表示」ボタンが表示中かどうかを返す。 */
  function isNewPostButtonVisible () {
    const statusEl = document.querySelector('[role="status"]')
    if (!statusEl) return false

    const button = statusEl.querySelector('button')
    return button && button.offsetHeight > 0
  }

  /** スクロール位置がタイムライン先頭付近かどうかを返す。 */
  function isNearTop () {
    return window.scrollY <= SCROLL_TOP_THRESHOLD
  }

  /**
   * 条件を満たす場合だけ新着ボタンを押す。
   * 入力: なし
   * 出力: なし
   * 主な処理内容: ユーザーが途中まで読んでいる最中の誤更新を避けるため、先頭付近でのみ動作する
   */
  function checkAndAutoRefresh () {
    if (!autoRefreshEnabled) return

    if (isNearTop() && isNewPostButtonVisible()) {
      const button = document.querySelector('[role="status"] button')
      if (button) {
        button.click()
        console.log('[X-Observer] 新着ポストを自動読み込みしました')
      }
    }
  }

  /** interval を開始して自動更新を有効化する。 */
  function startAutoRefresh () {
    if (autoRefreshTimer) return
    autoRefreshTimer = setInterval(checkAndAutoRefresh, AUTO_REFRESH_INTERVAL)
    autoRefreshEnabled = true
    console.log('[X-Observer] 自動更新: ON')
  }

  /** interval を止めて自動更新を無効化する。 */
  function stopAutoRefresh () {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    autoRefreshEnabled = false
    console.log('[X-Observer] 自動更新: OFF')
  }

  /** 現在状態を反転して自動更新を切り替える。 */
  function toggleAutoRefresh () {
    if (autoRefreshEnabled) {
      stopAutoRefresh()
    } else {
      startAutoRefresh()
    }
  }

  return {
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh
  }
}
