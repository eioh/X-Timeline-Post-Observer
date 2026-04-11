// DOM 上で「処理済み」と「非表示理由」を識別するための属性名。
// CSS クラスではなく data 属性にしているのは、X 側のクラス変動と衝突しにくくするため。
export const PROCESSED_ATTR = 'data-xtlo-processed'
export const HIDDEN_ATTR = 'data-xtlo-hidden'

// 非表示にした投稿を一定期間で自然消滅させるための期限設定。
// 恒久データにすると、過去の一時的な非表示が残り続けて管理しづらくなる。
export const EXPIRE_DAYS = 30
export const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000

// 設定 JSON の互換性判定に使う形式バージョン。
// 形式変更時は import 側の検証と必ずセットで更新する。
export const EXPORT_VERSION = 3

// Tampermonkey ストレージの保存キー一覧。
// モジュール分割後もキー名を散らさず、互換性影響をここで追えるようにしている。
export const STORAGE_KEYS = {
  mediaFilterLists: 'xtlo_mediaFilterLists',
  hiddenUserIds: 'xtlo_hiddenUserIds',
  followUserIds: 'xtlo_followUserIds',
  listUserIds: 'xtlo_listUserIds',
  hiddenWords: 'xtlo_hiddenWords',
  hiddenStatuses: 'xtlo_hiddenStatuses',
  hideUIEnabled: 'xtlo_hideUIEnabled',
  autoRefreshEnabled: 'xtlo_autoRefreshEnabled'
}

// 新着自動読込の間隔と、トップ判定に使うスクロール閾値。
// 厳密な 0px 判定だとわずかなズレで自動更新が止まりやすいため、少し余裕を持たせている。
export const AUTO_REFRESH_INTERVAL = 10 * 1000
export const SCROLL_TOP_THRESHOLD = 50

// X のヘッダーや投稿フォームを隠して閲覧領域を広げるための CSS。
export const HIDE_UI_CSS = `
  header[role="banner"] {
    display: none !important;
  }
  div:has(> div[role="progressbar"]):has(> div [data-testid="tweetTextarea_0"]) {
    display: none !important;
  }
`

// タイムライン密度を上げるため、アバター列を圧縮する CSS。
// レイアウト変更に弱い箇所なので、値は他ファイルへ分散させずここで管理する。
export const COMPACT_LAYOUT_CSS = `
  article div:has(> [data-testid="Tweet-User-Avatar"]) {
    flex-basis: 20px !important;
    margin-right: 4px !important;
  }

  article [data-testid="Tweet-User-Avatar"],
  article [data-testid="Tweet-User-Avatar"] div,
  article [data-testid="Tweet-User-Avatar"] a,
  article [data-testid="Tweet-User-Avatar"] img {
    width: 20px !important;
    height: 20px !important;
    min-width: 20px !important;
    min-height: 20px !important;
  }
`

// X 標準メニューに差し込む独自メニュー項目の見た目。
// 注入先は X 側 DOM に依存するため、少なくともクラス名と構造の対応関係が追えるように定数化している。
export const CUSTOM_MENU_CSS = `
  .xtlo-hide-post-menuitem {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .xtlo-hide-post-menuitem:hover {
    background-color: rgba(239, 243, 244, 0.1);
  }
  .xtlo-hide-post-menuitem .xtlo-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    width: 18.75px;
    height: 18.75px;
  }
  .xtlo-hide-post-menuitem .xtlo-icon svg {
    fill: rgb(239, 243, 244);
    width: 18.75px;
    height: 18.75px;
  }
  .xtlo-hide-post-menuitem .xtlo-label {
    color: rgb(239, 243, 244);
    font-family: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 20px;
    font-weight: 400;
  }
`
