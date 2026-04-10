import { AUTO_REFRESH_INTERVAL, SCROLL_TOP_THRESHOLD } from '../constants.js'

/**
 * 新着ポスト自動更新の制御オブジェクトを作る。
 * 入力: なし。
 * 出力: start / stop / toggle / applyEnabledState / isEnabled を持つオブジェクト。
 * 主な処理内容:
 * 1. interval の開始と停止を管理する
 * 2. タイムライン上部にいるときだけ新着ボタンを押す
 * 3. 外部から保存済み設定を反映できる API を提供する
 */
export function createAutoRefreshController () {
  let autoRefreshEnabled = true
  let autoRefreshTimer = null

  /** 「新しいポストを表示」ボタンが表示中かどうかを判定する。*/
  function isNewPostButtonVisible () {
    const statusEl = document.querySelector('[role="status"]')
    if (!statusEl) return false

    const button = statusEl.querySelector('button')
    return Boolean(button && button.offsetHeight > 0)
  }

  /** スクロール位置がタイムライン最上部付近かどうかを判定する。*/
  function isNearTop () {
    return window.scrollY <= SCROLL_TOP_THRESHOLD
  }

  /**
   * 条件を満たす場合だけ新着ボタンを押す。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定が OFF なら何もしない
   * 2. 最上部かつ新着ボタン表示中ならクリックする
   */
  function checkAndAutoRefresh () {
    if (!autoRefreshEnabled) return

    if (isNearTop() && isNewPostButtonVisible()) {
      const button = document.querySelector('[role="status"] button')
      if (button) {
        button.click()
        console.log('[X-Observer] 新着ポストを自動更新しました')
      }
    }
  }

  /** interval を開始して自動更新を有効化する。*/
  function startAutoRefresh () {
    if (autoRefreshTimer) return
    autoRefreshTimer = setInterval(checkAndAutoRefresh, AUTO_REFRESH_INTERVAL)
    autoRefreshEnabled = true
    console.log('[X-Observer] 自動更新: ON')
  }

  /** interval を停止して自動更新を無効化する。*/
  function stopAutoRefresh () {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    autoRefreshEnabled = false
    console.log('[X-Observer] 自動更新: OFF')
  }

  /** 現在の状態を反転して自動更新を切り替える。*/
  function toggleAutoRefresh () {
    if (autoRefreshEnabled) {
      stopAutoRefresh()
    } else {
      startAutoRefresh()
    }
  }

  /**
   * 保存済み設定の真偽値をそのまま自動更新状態へ反映する。
   * 入力: 有効にするかどうかの真偽値。
   * 出力: なし。
   * 主な処理内容:
   * 1. true なら interval を開始する
   * 2. false なら interval を停止する
   */
  function applyEnabledState (enabled) {
    if (enabled) {
      startAutoRefresh()
    } else {
      stopAutoRefresh()
    }
  }

  /** 現在の自動更新状態を返す。*/
  function isEnabled () {
    return autoRefreshEnabled
  }

  return {
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh,
    applyEnabledState,
    isEnabled
  }
}
