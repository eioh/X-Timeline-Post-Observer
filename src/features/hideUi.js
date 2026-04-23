import { COMPACT_LAYOUT_CSS, CUSTOM_MENU_CSS, HIDE_UI_CSS } from '../constants.js'
import { applyUserLabelStyles } from './userLabelColors.js'

// UI 非表示用の style 要素を保持する。
// ON/OFF のたびに style を探し直さずに済み、二重挿入も防げるため参照を保持する。
let hideUIStyleEl = null

/**
 * X のヘッダーや投稿フォームを表示/非表示にする。
 * 入力: true で非表示を有効化、false で解除。
 * 出力: なし。
 * 主な処理内容:
 * 1. 有効化時は style を挿入する
 * 2. 無効化時は既存 style を除去する
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

/** 現在の UI 非表示状態を返す。*/
export function isHideUIEnabled () {
  return Boolean(hideUIStyleEl)
}

/** 現在の状態を反転して UI 非表示を切り替える。*/
export function toggleHideUI () {
  setHideUI(!hideUIStyleEl)
}

/** 常時必要なレイアウト CSS と独自メニュー CSS を適用する。*/
export function applyBaseStyles () {
  GM_addStyle(COMPACT_LAYOUT_CSS)
  GM_addStyle(CUSTOM_MENU_CSS)
  applyUserLabelStyles()
}
