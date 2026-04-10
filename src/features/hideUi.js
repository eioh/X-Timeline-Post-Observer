import { COMPACT_LAYOUT_CSS, CUSTOM_MENU_CSS, HIDE_UI_CSS } from '../constants.js'

// UI 非表示用 style 要素の参照。
// ON/OFF 切り替え時に同じ style を外せるよう、生成結果を保持している。
let hideUIStyleEl = null

/**
 * X のヘッダーや投稿フォームを表示/非表示する。
 * 入力: true で非表示 ON、false で OFF
 * 出力: なし
 * 主な処理内容: GM_addStyle で差し込んだ style 要素を保持し、必要時に remove する
 */
export function setHideUI (enabled) {
  if (enabled && !hideUIStyleEl) {
    hideUIStyleEl = GM_addStyle(HIDE_UI_CSS)
    console.log('[X-Observer] UI非表示: ON')
  } else if (!enabled && hideUIStyleEl) {
    hideUIStyleEl.remove()
    hideUIStyleEl = null
    console.log('[X-Observer] UI非表示: OFF')
  }
}

/** 現在状態を反転して UI 非表示を切り替える。 */
export function toggleHideUI () {
  setHideUI(!hideUIStyleEl)
}

/** 常時必要なレイアウト CSS とメニュー CSS を適用する。 */
export function applyBaseStyles () {
  GM_addStyle(COMPACT_LAYOUT_CSS)
  GM_addStyle(CUSTOM_MENU_CSS)
}
