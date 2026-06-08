/**
 * prompt の戻り値を設定追加用に正規化する。
 * 入力: prompt が返した文字列または null。
 * 出力: trim 済み文字列、または空入力時の null。
 * 主な処理内容:
 * 1. キャンセル時は null を返す
 * 2. 前後空白を除去し、空文字は null 扱いにする
 */
function normalizePromptInput (input) {
  if (input === null) return null

  const normalized = input.trim()
  return normalized || null
}

/**
 * 投稿 ID 入力から statusId を取り出す。
 * 入力: 数字文字列、または投稿 URL。
 * 出力: statusId、解釈できない場合は null。
 * 主な処理内容:
 * 1. 純粋な数字ならそのまま返す
 * 2. URL からは /status/<数字> を抽出する
 */
function parseStatusId (input) {
  if (/^\d+$/.test(input)) {
    return input
  }

  // URL 全体を保存すると unrelated な数字まで拾う危険があるため、status パスだけを見る。
  const match = input.match(/\/status\/(\d+)/)
  return match ? match[1] : null
}

/**
 * Tampermonkey メニューへ設定操作コマンドを登録する。
 * 入力: 追加・表示・インポートなどに必要なコールバック群。
 * 出力: なし。
 * 主な処理内容:
 * 1. 設定ダイアログを開くメニューを登録する
 * 2. 既存の prompt ベース操作も後方互換として残す
 * 3. 追加やインポート後に画面へ再反映する
 */
export function registerMenuCommands ({
  addHiddenStatus,
  addHiddenUser,
  addFollowUser,
  addListUser,
  addHiddenWord,
  exportConfigToFile,
  importConfigFromFile,
  reapplyFilters,
  openSettingsDialog
}) {
  GM_registerMenuCommand('設定ダイアログを開く', () => {
    openSettingsDialog()
  })

  GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
    const userId = normalizePromptInput(
      prompt('非表示にしたいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
    )
    if (!userId) {
      console.log('[X-Observer] 空のユーザー ID 入力はキャンセルしました')
      return
    }

    await addHiddenUser(userId)
    reapplyFilters()
  })

  GM_registerMenuCommand('フォローユーザーIDを追加', async () => {
    const userId = normalizePromptInput(
      prompt('フォローとして記録したいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
    )
    if (!userId) {
      console.log('[X-Observer] 空のフォローユーザー ID 入力はキャンセルしました')
      return
    }

    await addFollowUser(userId)
    reapplyFilters()
  })

  GM_registerMenuCommand('リストインユーザーIDを追加', async () => {
    const userId = normalizePromptInput(
      prompt('リストインとして記録したいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
    )
    if (!userId) {
      console.log('[X-Observer] 空のリストインユーザー ID 入力はキャンセルしました')
      return
    }

    await addListUser(userId)
    reapplyFilters()
  })

  GM_registerMenuCommand('非表示ポストIDを追加', async () => {
    const rawInput = normalizePromptInput(
      prompt('非表示にしたいポスト ID またはポスト URL を入力してください')
    )
    if (!rawInput) {
      console.log('[X-Observer] 空のポスト ID 入力はキャンセルしました')
      return
    }

    const statusId = parseStatusId(rawInput)
    if (!statusId) {
      console.log('[X-Observer] ポスト ID を解釈できませんでした:', rawInput)
      return
    }

    await addHiddenStatus(statusId)
    reapplyFilters()
  })

  GM_registerMenuCommand('非表示キーワードを追加', async () => {
    const word = normalizePromptInput(
      prompt('非表示にしたいキーワードを入力してください')
    )
    if (!word) {
      console.log('[X-Observer] 空のキーワード入力はキャンセルしました')
      return
    }

    await addHiddenWord(word)
    reapplyFilters()
  })

  GM_registerMenuCommand('設定をエクスポート', () => {
    exportConfigToFile()
  })

  GM_registerMenuCommand('設定をインポート', async () => {
    await importConfigFromFile()
  })
}
