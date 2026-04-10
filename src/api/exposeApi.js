/**
 * コンソール操作用 API を unsafeWindow へ公開する。
 * 入力: 公開したい関数群を持つオブジェクト
 * 出力: なし
 * 主な処理内容: Tampermonkey サンドボックス越しに window.XObserver を提供する
 */
export function exposeApi (api) {
  unsafeWindow.XObserver = api
}
