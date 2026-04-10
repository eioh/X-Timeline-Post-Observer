/**
 * prompt の戻り値を登録用に正規化する。
 * 入力: prompt が返した文字列または null
 * 出力: trim 済み文字列。空入力やキャンセル時は null
 * 主な処理内容: 空白だけの入力を弾き、各メニュー処理の重複ロジックを減らす
 */
function normalizePromptInput (input) {
  if (input === null) return null

  const normalized = input.trim()
  return normalized || null
}

/**
 * 投稿 ID 入力から statusId を解釈する。
 * 入力: 数値文字列、または投稿 URL
 * 出力: statusId。解釈不能なら null
 * 主な処理内容: 素の ID はそのまま使い、URL は /status/<数字> 部分だけを抜き出す
 */
function parseStatusId (input) {
  if (/^\d+$/.test(input)) {
    return input
  }

  // URL 全体から雑に数値を拾うと unrelated な ID を誤登録するため、status パスに限定する。
  const match = input.match(/\/status\/(\d+)/)
  return match ? match[1] : null
}

/**
 * Tampermonkey メニューへ設定変更コマンドを登録する。
 * 入力: 追加・インポート・再適用などのコールバック群
 * 出力: なし
 * 主な処理内容:
 * 1. ユーザー・投稿・キーワードの追加メニューを作る
 * 2. エクスポート / インポートメニューを作る
 * 3. 登録後に現在画面へ即時反映する
 */
export function registerMenuCommands ({
  addHiddenStatus,
  addHiddenUser,
  addHiddenWord,
  exportConfigToFile,
  importConfigFromFile,
  reapplyFilters
}) {
  GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
    const userId = normalizePromptInput(
      prompt('非表示にしたいユーザーIDを入力してください（@あり/なし両対応）')
    )
    if (!userId) {
      console.log('[X-Observer] 空のユーザーID入力は無視しました')
      return
    }

    await addHiddenUser(userId)
    reapplyFilters()
  })

  GM_registerMenuCommand('非表示ポストIDを追加', async () => {
    const rawInput = normalizePromptInput(
      prompt('非表示にしたいポストIDまたは投稿URLを入力してください')
    )
    if (!rawInput) {
      console.log('[X-Observer] 空のポストID入力は無視しました')
      return
    }

    const statusId = parseStatusId(rawInput)
    if (!statusId) {
      console.log(
        '[X-Observer] ポストIDを抽出できなかったため登録を中止しました:',
        rawInput
      )
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
      console.log('[X-Observer] 空のキーワード入力は無視しました')
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
