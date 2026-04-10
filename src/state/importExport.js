import { EXPORT_VERSION } from '../constants.js'
import { config, loadConfig, replaceConfig } from './configStore.js'

/**
 * 現在設定をエクスポート用の JSON 形式へ変換する。
 * 入力: なし
 * 出力: version 付きプレーンオブジェクト
 * 主な処理内容: 参照共有を避けるため、配列や要素をコピーして返す
 */
export function createExportData () {
  return {
    version: EXPORT_VERSION,
    mediaFilterLists: [...config.mediaFilterLists],
    hiddenUserIds: [...config.hiddenUserIds],
    hiddenWords: [...config.hiddenWords],
    hiddenStatuses: config.hiddenStatuses.map(entry => ({
      statusId: entry.statusId,
      expiresAt: entry.expiresAt
    }))
  }
}

/**
 * JSON から読んだ設定を検証し、保存用形式へ正規化する。
 * 入力: JSON.parse 後の値
 * 出力: 保存可能な設定オブジェクト
 * 主な処理内容:
 * 1. version と各フィールド型を検証する
 * 2. hiddenStatuses の要素構造を確認する
 * 3. 重複除去や @ 除去で保存形式を揃える
 */
export function normalizeImportedConfig (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('設定JSONのルートはオブジェクトである必要があります')
  }

  if (raw.version !== EXPORT_VERSION) {
    throw new Error(`未対応の設定バージョンです: ${raw.version}`)
  }

  const { mediaFilterLists, hiddenUserIds, hiddenWords, hiddenStatuses } = raw

  if (
    !Array.isArray(mediaFilterLists) ||
    !Array.isArray(hiddenUserIds) ||
    !Array.isArray(hiddenWords) ||
    !Array.isArray(hiddenStatuses)
  ) {
    throw new Error('設定JSONの配列フィールド形式が不正です')
  }

  const normalizedStatuses = hiddenStatuses.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`hiddenStatuses[${index}] はオブジェクトである必要があります`)
    }
    if (typeof entry.statusId !== 'string' || !/^\d+$/.test(entry.statusId)) {
      throw new Error(`hiddenStatuses[${index}].statusId が不正です`)
    }
    if (typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) {
      throw new Error(`hiddenStatuses[${index}].expiresAt が不正です`)
    }

    return {
      statusId: entry.statusId,
      expiresAt: entry.expiresAt
    }
  })

  // 取り込み時に表記ゆれと重複を潰しておくことで、判定側を単純な includes / some に保つ。
  return {
    mediaFilterLists: [
      ...new Set(mediaFilterLists.filter(item => typeof item === 'string'))
    ],
    hiddenUserIds: [
      ...new Set(
        hiddenUserIds
          .filter(item => typeof item === 'string')
          .map(item => item.replace(/^@/, ''))
      )
    ],
    hiddenWords: [...new Set(hiddenWords.filter(item => typeof item === 'string'))],
    hiddenStatuses: normalizedStatuses.filter(
      (entry, index, entries) =>
        entries.findIndex(item => item.statusId === entry.statusId) === index
    )
  }
}

/**
 * 現在設定を JSON ファイルとしてダウンロードさせる。
 * 入力: なし
 * 出力: なし
 * 主な処理内容: Blob URL と一時 a 要素を使って保存ダイアログを開く
 */
export function exportConfigToFile () {
  const exportText = JSON.stringify(createExportData(), null, 2)
  const blob = new Blob([exportText], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  anchor.href = url
  anchor.download = `xtlo-config-${timestamp}.json`

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)

  console.log('[X-Observer] 設定をエクスポートしました')
  alert('設定をエクスポートしました')
}

/**
 * JSON ファイルを選ばせて設定を丸ごと置き換える。
 * 入力: 再適用コールバックを持つオブジェクト
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. ファイル選択ダイアログを開く
 * 2. JSON を検証・正規化する
 * 3. 保存内容を置換し、画面へ即時反映する
 */
export async function importConfigFromFile ({ reapplyFilters }) {
  const file = await new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'

    input.addEventListener(
      'change',
      () => {
        resolve(input.files && input.files[0] ? input.files[0] : null)
      },
      { once: true }
    )
    input.click()
  })

  if (!file) {
    console.log('[X-Observer] 設定インポートはキャンセルされました')
    return
  }

  const text = await file.text()

  try {
    const parsed = JSON.parse(text)
    const normalized = normalizeImportedConfig(parsed)

    await replaceConfig(normalized)
    await loadConfig()
    reapplyFilters()

    console.log(
      '[X-Observer] 設定をインポートしました:',
      JSON.parse(JSON.stringify(config))
    )
    alert('設定をインポートしました')
  } catch (error) {
    // 検証失敗時に保存済み設定を壊さないため、置換処理前で必ず止める。
    console.error('[X-Observer] 設定インポートに失敗しました:', error)
    alert(`設定インポートに失敗しました: ${error.message}`)
  }
}
