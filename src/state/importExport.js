import { EXPORT_VERSION } from '../constants.js'
import { config, loadConfig, replaceConfig } from './configStore.js'

/**
 * 現在の設定をエクスポート用オブジェクトへ整形する。
 * 入力: なし。
 * 出力: version 付きのプレーンオブジェクト。
 * 主な処理内容:
 * 1. 配列を複製して参照共有を避ける
 * 2. 設定画面で扱う真偽値設定も一緒に含める
 */
export function createExportData () {
  return {
    version: EXPORT_VERSION,
    mediaFilterLists: [...config.mediaFilterLists],
    hiddenUserIds: [...config.hiddenUserIds],
    followUserIds: [...config.followUserIds],
    listUserIds: [...config.listUserIds],
    hiddenWords: [...config.hiddenWords],
    hiddenStatuses: config.hiddenStatuses.map(entry => ({
      statusId: entry.statusId,
      expiresAt: entry.expiresAt
    })),
    settings: {
      hideUIEnabled: config.hideUIEnabled,
      autoRefreshEnabled: config.autoRefreshEnabled
    }
  }
}

/**
 * JSON から読み込んだ設定を検証し、内部で使う形式へ正規化する。
 * 入力: JSON.parse 後の値。
 * 出力: 保存可能な設定オブジェクト。
 * 主な処理内容:
 * 1. バージョンと配列構造を検証する
 * 2. v1 には無かった settings を既定値で補完する
 * 3. ユーザー ID や重複値を正規化する
 */
export function normalizeImportedConfig (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('設定 JSON のルートはオブジェクトである必要があります')
  }

  if (![1, 2, EXPORT_VERSION].includes(raw.version)) {
    throw new Error(`未対応の設定バージョンです: ${raw.version}`)
  }

  const {
    mediaFilterLists,
    hiddenUserIds,
    hiddenWords,
    hiddenStatuses
  } = raw
  const followUserIds = raw.version >= 3 ? raw.followUserIds : []
  const listUserIds = raw.version >= 3 ? raw.listUserIds : []

  if (
    !Array.isArray(mediaFilterLists) ||
    !Array.isArray(hiddenUserIds) ||
    !Array.isArray(followUserIds) ||
    !Array.isArray(listUserIds) ||
    !Array.isArray(hiddenWords) ||
    !Array.isArray(hiddenStatuses)
  ) {
    throw new Error('設定 JSON の配列項目が不正です')
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

  const rawSettings = raw.version >= 2 ? raw.settings : null
  if (
    rawSettings !== null &&
    (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings))
  ) {
    throw new Error('settings はオブジェクトである必要があります')
  }

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
    followUserIds: [
      ...new Set(
        followUserIds
          .filter(item => typeof item === 'string')
          .map(item => item.replace(/^@/, ''))
      )
    ],
    listUserIds: [
      ...new Set(
        listUserIds
          .filter(item => typeof item === 'string')
          .map(item => item.replace(/^@/, ''))
      )
    ],
    hiddenWords: [...new Set(hiddenWords.filter(item => typeof item === 'string'))],
    hiddenStatuses: normalizedStatuses.filter(
      (entry, index, entries) =>
        entries.findIndex(item => item.statusId === entry.statusId) === index
    ),
    hideUIEnabled:
      typeof rawSettings?.hideUIEnabled === 'boolean'
        ? rawSettings.hideUIEnabled
        : true,
    autoRefreshEnabled:
      typeof rawSettings?.autoRefreshEnabled === 'boolean'
        ? rawSettings.autoRefreshEnabled
        : true
  }
}

/**
 * 現在の設定を JSON ファイルとしてダウンロードさせる。
 * 入力: なし。
 * 出力: なし。
 * 主な処理内容:
 * 1. 設定を整形して Blob 化する
 * 2. 一時的なリンクを作成してダウンロードを開始する
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
 * JSON ファイルを選ばせて設定を取り込み、画面へ再反映する。
 * 入力: 再適用コールバックを持つオブジェクト。
 * 出力: Promise<void>
 * 主な処理内容:
 * 1. ファイル選択ダイアログを開く
 * 2. JSON を検証して保存する
 * 3. 最新設定を再読込して reapplyFilters を呼ぶ
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
    // パース失敗時も理由を明示しておくと、ファイル形式の不一致と実装不具合を切り分けやすい。
    console.error('[X-Observer] 設定インポートに失敗しました:', error)
    alert(`設定インポートに失敗しました: ${error.message}`)
  }
}
