import { config } from '../state/configStore.js'
import { normalizeUserId } from '../utils/userIds.js'

const PAGE_SIZE = 500
const CUSTOM_TAB_PREFIX = 'custom:'
const DEFAULT_CUSTOM_CATEGORY_COLOR = '#f5c542'
const TAB_DEFINITIONS = [
  { key: 'users',    label: 'ユーザー',   placeholder: '[@]user_id / internal_id', category: 'hide' },
  { key: 'statuses', label: 'ポスト',     placeholder: 'post_id / URL', category: 'hide' },
  { key: 'words',    label: 'キーワード', placeholder: 'keyword',       category: 'hide' },
  { key: 'media',    label: 'メディア',   placeholder: 'リスト名',      category: 'hide' },
  { key: 'follow',   label: 'フォロー',   placeholder: '[@]user_id / internal_id', category: 'color' },
  { key: 'list',     label: 'リスト',     placeholder: '[@]user_id / internal_id', category: 'color' },
  { key: 'settings', label: '基本',       placeholder: '',              category: 'settings' },
  { key: 'categorySettings', label: '分類', placeholder: '',             category: 'settings' }
]
const CATEGORY_DEFINITIONS = [
  { key: 'hide',     label: '非表示' },
  { key: 'color',    label: '分類' },
  { key: 'settings', label: '設定' }
]


/**
 * ユーザー定義分類のタブキーを作る。
 * 入力: 分類 ID。
 * 出力: 設定ダイアログ内で使うタブキー。
 * 主な処理内容:
 * 1. 既存タブと衝突しないよう専用プレフィックスを付ける
 */
function getCustomCategoryTabKey (categoryId) {
  return `${CUSTOM_TAB_PREFIX}${categoryId}`
}

/**
 * タブキーからユーザー定義分類 ID を取り出す。
 * 入力: タブキー。
 * 出力: 分類 ID。ユーザー定義分類でなければ null。
 * 主な処理内容:
 * 1. 専用プレフィックスを持つタブだけ分類 ID として扱う
 */
function getCustomCategoryIdFromTabKey (tabKey) {
  return tabKey.startsWith(CUSTOM_TAB_PREFIX)
    ? tabKey.slice(CUSTOM_TAB_PREFIX.length)
    : null
}

/**
 * タブキーに対応するユーザー定義分類を返す。
 * 入力: タブキー。
 * 出力: 分類オブジェクト。該当しなければ null。
 * 主な処理内容:
 * 1. タブキーから分類 ID を取り出す
 * 2. 現在の config から一致する分類を探す
 */
function getCustomCategoryForTab (tabKey) {
  const categoryId = getCustomCategoryIdFromTabKey(tabKey)
  if (!categoryId) return null

  return config.customUserCategories.find(category => category.id === categoryId) ?? null
}

/**
 * 固定タブとユーザー定義分類タブを合わせて返す。
 * 入力: なし。
 * 出力: タブ定義配列。
 * 主な処理内容:
 * 1. 固定タブを先に並べる
 * 2. ユーザー定義分類を分類カテゴリの小項目として追加する
 */
function getAllTabDefinitions () {
  return [
    ...TAB_DEFINITIONS,
    ...config.customUserCategories.map(category => ({
      key: getCustomCategoryTabKey(category.id),
      label: category.label,
      placeholder: '[@]user_id / internal_id',
      category: 'color',
      customCategoryId: category.id
    }))
  ]
}

const DIALOG_STYLE = `
  .xtlo-settings-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.66);
    backdrop-filter: blur(10px);
    z-index: 2147483647;
    padding: 16px;
  }

  .xtlo-settings-dialog {
    width: min(720px, calc(100vw - 24px));
    height: min(640px, calc(100vh - 24px));
    max-height: min(640px, calc(100vh - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      radial-gradient(circle at top left, rgba(29, 155, 240, 0.12), transparent 34%),
      linear-gradient(180deg, rgba(23, 23, 23, 0.98), rgba(9, 9, 9, 0.98));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    color: #f5f7fa;
    font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
  }

  .xtlo-settings-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .xtlo-settings-title {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .xtlo-settings-close {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-category-tabs {
    display: flex;
    align-items: flex-end;
    gap: 22px;
    width: 100%;
  }

  .xtlo-settings-category-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 34px;
    padding: 0 10px 10px;
    border: 0;
    border-radius: 8px 8px 0 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-category-tab:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.92);
  }

  .xtlo-settings-category-tab[data-active="true"] {
    color: #ffffff;
  }

  .xtlo-settings-category-tab[data-active="true"]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 3px;
    border-radius: 999px;
    background: #1d9bf0;
  }

  .xtlo-settings-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0;
  }

  .xtlo-settings-layout {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .xtlo-settings-side-tabs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 10px 16px 16px;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.025);
    overflow: auto;
  }

  .xtlo-settings-side-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.68);
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .xtlo-settings-side-tab:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
  }

  .xtlo-settings-side-tab[data-active="true"] {
    background: rgba(29, 155, 240, 0.16);
    color: #ffffff;
  }

  .xtlo-settings-side-icon {
    display: inline-flex;
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .xtlo-settings-side-icon svg {
    width: 100%;
    height: 100%;
  }


  .xtlo-settings-side-tab-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .xtlo-settings-category-manager {
    display: grid;
    gap: 14px;
  }

  .xtlo-settings-category-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px auto;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
  }

  .xtlo-settings-color-input {
    width: 44px;
    height: 36px;
    padding: 4px;
    border: 0;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }

  .xtlo-settings-category-list {
    display: grid;
    gap: 8px;
  }

  .xtlo-settings-category-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 44px 34px;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
  }

  .xtlo-settings-category-swatch {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.16);
  }

  .xtlo-settings-category-meta {
    min-width: 0;
  }

  .xtlo-settings-category-name {
    overflow: hidden;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .xtlo-settings-category-count {
    color: rgba(255, 255, 255, 0.52);
    font-size: 12px;
  }

  .xtlo-settings-content {
    min-width: 0;
    overflow: auto;
    padding: 16px 20px 14px;
  }

  .xtlo-settings-add-row {
    display: flex;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
    margin-bottom: 14px;
  }

  .xtlo-settings-search-row {
    display: flex;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    margin-bottom: 10px;
  }

  .xtlo-settings-input {
    flex: 1;
    border: 0;
    outline: none;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px 14px;
    color: #ffffff;
    font-size: 14px;
  }

  .xtlo-settings-search-input {
    flex: 1;
    border: 0;
    outline: none;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 9px 12px;
    color: #ffffff;
    font-size: 13px;
  }

  .xtlo-settings-input::placeholder,
  .xtlo-settings-search-input::placeholder {
    color: rgba(255, 255, 255, 0.32);
  }

  .xtlo-settings-primary {
    border: 0;
    border-radius: 10px;
    background: linear-gradient(180deg, #38a3ff, #1d84d8);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    padding: 0 16px;
    cursor: pointer;
  }

  .xtlo-settings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .xtlo-settings-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .xtlo-settings-icon {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: #dce8f5;
    background: rgba(255, 255, 255, 0.11);
    flex-shrink: 0;
  }

  .xtlo-settings-item-text {
    flex: 1;
    min-width: 0;
  }

  .xtlo-settings-item-title {
    font-size: 13px;
    font-weight: 700;
    word-break: break-all;
  }

  .xtlo-settings-item-subtitle {
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.54);
    font-size: 11px;
  }

  .xtlo-settings-danger-icon {
    border: 0;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }

  .xtlo-settings-danger-icon:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .xtlo-settings-empty {
    padding: 28px 12px;
    text-align: center;
    color: rgba(255, 255, 255, 0.54);
    font-size: 13px;
  }

  .xtlo-settings-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px 0 6px;
  }

  .xtlo-settings-page-btn {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.84);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-page-btn:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .xtlo-settings-page-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-page-current {
    width: 48px;
    text-align: center;
    padding: 6px 0;
    border-radius: 8px;
    border: 0;
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 20px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-clear {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-badge {
    border-radius: 10px;
    padding: 6px 12px;
    background: rgba(84, 95, 110, 0.72);
    color: #dce4ef;
    font-size: 12px;
    font-weight: 700;
  }

  .xtlo-settings-settings-grid {
    display: grid;
    gap: 10px;
  }

  .xtlo-settings-toggle-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
  }

  .xtlo-settings-toggle-copy {
    flex: 1;
  }

  .xtlo-settings-toggle-title {
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-toggle-desc {
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.58);
    font-size: 11px;
    line-height: 1.5;
  }

  .xtlo-settings-switch {
    position: relative;
    width: 44px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    cursor: pointer;
    flex-shrink: 0;
  }

  .xtlo-settings-switch[data-enabled="true"] {
    background: #1d9bf0;
  }

  .xtlo-settings-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #ffffff;
    transition: transform 0.18s ease;
  }

  .xtlo-settings-switch[data-enabled="true"]::after {
    transform: translateX(18px);
  }

  .xtlo-settings-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .xtlo-settings-secondary {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-hint {
    color: rgba(255, 255, 255, 0.54);
    font-size: 12px;
    line-height: 1.6;
  }

  @media (max-width: 700px) {
    .xtlo-settings-overlay {
      padding: 12px;
      align-items: stretch;
    }

    .xtlo-settings-dialog {
      width: 100%;
      height: auto;
      max-height: none;
      border-radius: 22px;
    }

    .xtlo-settings-header {
      padding: 14px 14px 0;
    }

    .xtlo-settings-category-tabs {
      gap: 18px;
      overflow: auto;
    }

    .xtlo-settings-layout {
      grid-template-columns: 112px minmax(0, 1fr);
      height: auto;
    }

    .xtlo-settings-side-tabs {
      padding: 12px 8px;
    }

    .xtlo-settings-side-tab {
      min-height: 34px;
      padding: 0 8px;
      font-size: 12px;
    }

    .xtlo-settings-content {
      padding: 12px;
    }

    .xtlo-settings-add-row,
    .xtlo-settings-search-row,
    .xtlo-settings-footer,
    .xtlo-settings-toggle-card {
      flex-direction: column;
      align-items: stretch;
    }

    .xtlo-settings-primary,
    .xtlo-settings-secondary,
    .xtlo-settings-switch {
      align-self: flex-start;
    }
  }
`

/**
 * ステータス ID または URL を statusId へ正規化する。
 * 入力: ダイアログから受け取った文字列。
 * 出力: 数字文字列、解釈できない場合は null。
 * 主な処理内容:
 * 1. 数字のみ入力はそのまま返す
 * 2. URL からは /status/<数字> の部分だけを抜き出す
 */
function normalizeStatusInput (value) {
  if (/^\d+$/.test(value)) {
    return value
  }

  const match = value.match(/\/status\/(\d+)/)
  return match ? match[1] : null
}

/**
 * 入力されたページ番号を安全な範囲へ丸める。
 * 入力: ユーザー入力値と総ページ数。
 * 出力: 1 以上 totalPages 以下の整数ページ番号。
 * 主な処理内容:
 * 1. 数値へ解釈できない値は 1 に戻す
 * 2. 小数や範囲外の値を表示可能なページへ補正する
 */
function normalizePageNumber (value, totalPages) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.min(Math.max(parsed, 1), totalPages)
}

/**
 * タブごとの一覧データモデルを返す。
 * 入力: タブキー。
 * 出力: raw 配列、表示用変換、検索判定を持つモデル。
 * 主な処理内容:
 * 1. 保存配列を表示直前まで raw のまま扱う
 * 2. ページネーション後に必要な項目だけ item 化できるようにする
 */
function getTabListModel (tabKey) {
  if (tabKey === 'users') {
    return createUserIdListModel(config.hiddenUserIds, 'ユーザーID')
  }

  if (tabKey === 'follow') {
    return createUserIdListModel(config.followUserIds, 'フォローユーザー')
  }

  if (tabKey === 'list') {
    return createUserIdListModel(config.listUserIds, 'リストインユーザー')
  }


  const customCategory = getCustomCategoryForTab(tabKey)
  if (customCategory) {
    return createUserIdListModel(
      customCategory.userIds,
      `${customCategory.label}ユーザー`
    )
  }

  if (tabKey === 'statuses') {
    return {
      rawItems: config.hiddenStatuses,
      toItem: entry => ({
        value: entry.statusId,
        title: entry.statusId,
        subtitle: `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
      }),
      matchesQuery: (entry, normalizedQuery) => {
        const subtitle = `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
        return [entry.statusId, subtitle].some(value =>
          String(value).toLowerCase().includes(normalizedQuery)
        )
      }
    }
  }

  if (tabKey === 'words') {
    return createTextListModel(config.hiddenWords, 'キーワード')
  }

  return createTextListModel(config.mediaFilterLists, 'メディアフィルタ')
}

/**
 * ユーザー ID 系の一覧モデルを作る。
 * 入力: ユーザー ID 配列、サブタイトル。
 * 出力: raw 配列を表示・検索するためのモデル。
 * 主な処理内容:
 * 1. @付きタイトルは表示時だけ生成する
 * 2. 検索時は raw 文字列と固定文言だけで判定する
 */
function createUserIdListModel (rawItems, subtitle) {
  return {
    rawItems,
    toItem: value => ({
      value,
      title: `@${value}`,
      subtitle
    }),
    matchesQuery: (value, normalizedQuery) =>
      [value, `@${value}`, subtitle].some(item =>
        String(item).toLowerCase().includes(normalizedQuery)
      )
  }
}

/**
 * 単純な文字列一覧モデルを作る。
 * 入力: 文字列配列、サブタイトル。
 * 出力: raw 配列を表示・検索するためのモデル。
 * 主な処理内容:
 * 1. 表示項目はページ内だけで生成する
 * 2. 検索時は raw 文字列と固定文言だけで判定する
 */
function createTextListModel (rawItems, subtitle) {
  return {
    rawItems,
    toItem: value => ({
      value,
      title: value,
      subtitle
    }),
    matchesQuery: (value, normalizedQuery) =>
      [value, subtitle].some(item =>
        String(item).toLowerCase().includes(normalizedQuery)
      )
  }
}

/**
 * 検索語に一致する raw 項目だけを返す。
 * 入力: 一覧モデルと検索語。
 * 出力: 検索語が空なら raw 配列、一致語がある場合は絞り込み後の配列。
 * 主な処理内容:
 * 1. 検索なしでは元配列をそのまま返して全件走査を避ける
 * 2. 検索ありではモデルごとの軽量判定で絞り込む
 */
function filterRawItemsByQuery (model, query) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return model.rawItems
  }

  return model.rawItems.filter(item => model.matchesQuery(item, normalizedQuery))
}

/**
 * 小項目キーから所属する大分類キーを返す。
 * 入力: 小項目のタブキー。
 * 出力: 大分類キー。見つからない場合は非表示分類。
 * 主な処理内容:
 * 1. ユーザー定義分類タブは分類カテゴリへ固定する
 * 2. 固定タブは TAB_DEFINITIONS から現在タブの定義を探す
 */
function getCategoryKeyForTab (tabKey) {
  if (getCustomCategoryIdFromTabKey(tabKey)) {
    return 'color'
  }

  return TAB_DEFINITIONS.find(tab => tab.key === tabKey)?.category ?? 'hide'
}

/**
 * 大分類に属する小項目定義だけを返す。
 * 入力: 大分類キー。
 * 出力: 該当する小項目定義配列。
 * 主な処理内容:
 * 1. 固定タブとユーザー定義分類タブから category が一致するものだけを抽出する
 */
function getTabsForCategory (categoryKey) {
  return getAllTabDefinitions().filter(tab => tab.category === categoryKey)
}

/**
 * 大分類を開いたとき最初に選ぶ小項目キーを返す。
 * 入力: 大分類キー。
 * 出力: 先頭の小項目キー。見つからない場合は users。
 * 主な処理内容:
 * 1. 大分類内の先頭タブを取得する
 * 2. 未定義分類でも描画を続けられるよう既定値を返す
 */
function getDefaultTabForCategory (categoryKey) {
  return getTabsForCategory(categoryKey)[0]?.key ?? 'users'
}

/**
 * ダイアログに使う設定 UI を生成する。
 * 入力: 各種追加・削除・保存コールバック。
 * 出力: open / close を持つオブジェクト。
 * 主な処理内容:
 * 1. モーダル DOM を初期化する
 * 2. タブ、ページネーション、追加・削除 UI を描画する
 * 3. 設定変更時に既存保存ロジックと再適用処理を呼び出す
 */
export function createSettingsDialog ({
  addHiddenStatus,
  removeHiddenStatus,
  addHiddenUser,
  removeHiddenUser,
  clearHiddenUsers,
  addFollowUser,
  removeFollowUser,
  clearFollowUsers,
  addListUser,
  removeListUser,
  clearListUsers,
  addCustomUserCategory,
  removeCustomUserCategory,
  addCustomCategoryUser,
  removeCustomCategoryUser,
  clearCustomCategoryUsers,
  setCustomUserCategoryColor,
  addHiddenWord,
  removeHiddenWord,
  addMediaFilterList,
  removeMediaFilterList,
  setHideUI,
  setHideUIEnabled,
  applyAutoRefreshEnabled,
  setAutoRefreshEnabled,
  exportConfigToFile,
  importConfigFromFile,
  reapplyFilters
}) {
  let styleInjected = false
  let overlay = null
  let currentTab = 'users'
  const pageByTab = {
    users: 1,
    follow: 1,
    list: 1,
    statuses: 1,
    words: 1,
    media: 1,
    settings: 1
  }
  const searchByTab = {
    users: '',
    follow: '',
    list: '',
    statuses: '',
    words: '',
    media: ''
  }


  /**
   * 動的タブ用のページ番号と検索語を初期化する。
   * 入力: タブキー。
   * 出力: なし。
   * 主な処理内容:
   * 1. ユーザー定義分類タブが後から増えても状態オブジェクトへ初期値を入れる
   */
  function ensureTabState (tabKey) {
    if (!pageByTab[tabKey]) {
      pageByTab[tabKey] = 1
    }
    if (tabKey !== 'settings' && searchByTab[tabKey] === undefined) {
      searchByTab[tabKey] = ''
    }
  }

  /**
   * ダイアログ共通スタイルを一度だけ挿入する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 多重に style が増えないよう初回だけ GM_addStyle を呼ぶ
   */
  function ensureStyle () {
    if (styleInjected) return
    GM_addStyle(DIALOG_STYLE)
    styleInjected = true
  }

  /**
   * 追加対象ごとのコールバックと文言を返す。
   * 入力: タブキー。
   * 出力: 追加や削除に必要な設定情報。
   * 主な処理内容:
   * 1. タブごとに保存関数を切り替える
   * 2. 全削除ボタンの文言もここでまとめる
   */
  function getTabActions (tabKey) {
    if (tabKey === 'users') {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all users',
        totalLabel: 'Active Filters',
        addItem: async value => addHiddenUser(value),
        removeItem: async value => removeHiddenUser(value),
        clearAll: async () => {
          await clearHiddenUsers()
          reapplyFilters()
        },
        normalizeInput: value => normalizeUserId(value)
      }
    }

    if (tabKey === 'follow') {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all follows',
        totalLabel: 'Known Users',
        addItem: async value => addFollowUser(value),
        removeItem: async value => removeFollowUser(value),
        clearAll: async () => {
          await clearFollowUsers()
          reapplyFilters()
        },
        normalizeInput: value => normalizeUserId(value)
      }
    }

    if (tabKey === 'list') {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all lists',
        totalLabel: 'Known Users',
        addItem: async value => addListUser(value),
        removeItem: async value => removeListUser(value),
        clearAll: async () => {
          await clearListUsers()
          reapplyFilters()
        },
        normalizeInput: value => normalizeUserId(value)
      }
    }


    const customCategory = getCustomCategoryForTab(tabKey)
    if (customCategory) {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: `Clear all ${customCategory.label}`,
        totalLabel: 'Known Users',
        addItem: async value => addCustomCategoryUser(customCategory.id, value),
        removeItem: async value => removeCustomCategoryUser(customCategory.id, value),
        clearAll: async () => {
          await clearCustomCategoryUsers(customCategory.id)
          reapplyFilters()
        },
        normalizeInput: value => normalizeUserId(value)
      }
    }

    if (tabKey === 'statuses') {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all posts',
        totalLabel: 'Active Filters',
        addItem: async value => addHiddenStatus(value),
        removeItem: async value => removeHiddenStatus(value),
        clearAll: async () => {
          for (const entry of [...config.hiddenStatuses]) {
            await removeHiddenStatus(entry.statusId)
          }
          reapplyFilters()
        },
        normalizeInput: value => normalizeStatusInput(value)
      }
    }

    if (tabKey === 'words') {
      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all words',
        totalLabel: 'Active Filters',
        addItem: async value => addHiddenWord(value),
        removeItem: async value => removeHiddenWord(value),
        clearAll: async () => {
          for (const value of [...config.hiddenWords]) {
            await removeHiddenWord(value)
          }
          reapplyFilters()
        },
        normalizeInput: value => value
      }
    }

    return {
      itemCount: getTabListModel(tabKey).rawItems.length,
      addLabel: 'Add',
      clearLabel: 'Clear all media',
      totalLabel: 'Media Filters',
      addItem: async value => addMediaFilterList(value),
      removeItem: async value => removeMediaFilterList(value),
      clearAll: async () => {
        for (const value of [...config.mediaFilterLists]) {
          await removeMediaFilterList(value)
        }
        reapplyFilters()
      },
      normalizeInput: value => value
    }
  }

  /**
   * タブと現在件数に応じてフッター文言を返す。
   * 入力: タブキーと件数。
   * 出力: ラベル文字列。
   * 主な処理内容:
   * 1. 設定タブだけは件数ではなく状態数として表現する
   */
  function getFooterBadgeLabel (tabKey, count) {
    if (tabKey === 'categorySettings') {
      return `${count} Categories`
    }

    if (tabKey === 'settings') {
      return `${count} Settings`
    }
    return `${count} Active Filters`
  }

  /**
   * 検索中の件数表示ラベルを返す。
   * 入力: タブキー、検索後件数、全件数。
   * 出力: フッターに表示する件数ラベル。
   * 主な処理内容:
   * 1. 検索語がある場合は一致件数と全件数を併記する
   * 2. 検索していない場合は従来どおり全件数だけを表示する
   */
  function getFilteredFooterBadgeLabel (tabKey, filteredCount, totalCount) {
    const baseLabel = getFooterBadgeLabel(tabKey, filteredCount)
    if (!searchByTab[tabKey]) {
      return baseLabel
    }

    return `${filteredCount} / ${totalCount} Active Filters`
  }

  /**
   * 現在の大分類に対応する左側小項目ナビを描画する。
   * 入力: 大分類キー。
   * 出力: 小項目ボタンの HTML 文字列。
   * 主な処理内容:
   * 1. 大分類内の小項目だけを縦並びボタンへ変換する
   * 2. 現在選択中の小項目へ active 状態を付ける
   */
  function renderSideTabs (categoryKey) {
    return getTabsForCategory(categoryKey)
      .map(tab => `
        <button class="xtlo-settings-side-tab" data-tab="${escapeAttribute(tab.key)}" data-active="${String(tab.key === currentTab)}">
          <span class="xtlo-settings-side-icon">${getListIcon(tab.key)}</span>
          <span class="xtlo-settings-side-tab-label">${escapeHtml(tab.label)}</span>
        </button>
      `)
      .join('')
  }

  /**
   * ページネーション UI を描画する。
   * 入力: 現在ページと総ページ数。
   * 出力: 前後移動ボタンとページ入力欄の HTML 文字列。
   * 主な処理内容:
   * 1. 上部と下部で同じ操作 UI を使えるよう HTML を共通化する
   * 2. 端ページでは前後移動ボタンを無効化する
   */
  function renderPagination (currentPage, totalPages) {
    return `
      <div class="xtlo-settings-pagination">
        <button class="xtlo-settings-page-btn" data-action="prev-page" ${currentPage <= 1 ? 'disabled' : ''} aria-label="前のページ">‹</button>
        <div class="xtlo-settings-page-indicator">
          <input class="xtlo-settings-page-current" data-role="page-input" inputmode="numeric" value="${currentPage}" aria-label="現在のページ" />
          <div>/ ${totalPages}</div>
        </div>
        <button class="xtlo-settings-page-btn" data-action="next-page" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="次のページ">›</button>
      </div>
    `
  }

  /** ゴミ箱アイコン SVG を返す。*/
  function getTrashIcon () {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 6V4.5A1.5 1.5 0 0 0 14.5 3h-5A1.5 1.5 0 0 0 8 4.5V6H4v2h1v10.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8h1V6h-4zm-6-.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V6h-4V5.5zm-1 4h2v7H9v-7zm4 0h2v7h-2v-7z"/>
      </svg>
    `
  }

  /** リストアイコン SVG を返す。*/
  function getListIcon (tabKey) {
    if (tabKey === 'users') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z"/>
        </svg>
      `
    }

    if (tabKey === 'statuses') {
      return `
        <svg viewBox="0 -1 24 24" aria-hidden="true">
          <path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12l4-4h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-2 8H6v-2h12zm0-3H6V7h12z"/>
        </svg>
      `
    }

    if (tabKey === 'words') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5 5h14v3h-5v12h-4V8H5z"/>
        </svg>
      `
    }

    if (tabKey === 'media') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8zm2 1h4v2H8zm0 3h8v2H8z"/>
        </svg>
      `
    }

    if (tabKey === 'follow') {
      return `
        <svg viewBox="0 -2 24 24" aria-hidden="true">
          <path fill="currentColor" d="M17 7a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm5 2c-2.33 0-7 1.17-7 3.5V16h14v-2.5C21 11.17 16.33 10 14 10zm-5 1c-2.67 0-8 1.34-8 4v1h4v-2.5c0-.9.37-1.72 1.03-2.4A12.7 12.7 0 0 1 9 11z"/>
        </svg>
      `
    }

    if (tabKey === 'list') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M4 6h3v3H4zm0 5h3v3H4zm0 5h3v3H4zm5-10h11v3H9zm0 5h11v3H9zm0 5h11v3H9z"/>
        </svg>
      `
    }

    if (getCustomCategoryIdFromTabKey(tabKey) || tabKey === 'categorySettings') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 3 3 8l9 5 9-5zm-6 8.2V16l6 3 6-3v-4.8l-6 3.3z"/>
        </svg>
      `
    }

    if (tabKey === 'settings') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M19.14 12.94a7.49 7.49 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.49 7.49 0 0 0 0 1.88L2.79 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.24 1.12-.56 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/>
        </svg>
      `
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8z"/>
      </svg>
    `
  }


  /**
   * 分類管理タブの HTML を返す。
   * 入力: なし。
   * 出力: 分類追加フォームと既存分類一覧の HTML 文字列。
   * 主な処理内容:
   * 1. 分類名と色を指定して追加できるフォームを作る
   * 2. 既存分類ごとに色変更と削除ボタンを配置する
   */
  function renderCategorySettings () {
    const rows = config.customUserCategories.length
      ? config.customUserCategories.map(category => `
        <div class="xtlo-settings-category-row">
          <span class="xtlo-settings-category-swatch" style="background: ${escapeAttribute(category.color || DEFAULT_CUSTOM_CATEGORY_COLOR)}"></span>
          <div class="xtlo-settings-category-meta">
            <div class="xtlo-settings-category-name">${escapeHtml(category.label)}</div>
            <div class="xtlo-settings-category-count">${category.userIds.length} users</div>
          </div>
          <input class="xtlo-settings-color-input" type="color" data-action="set-category-color" data-category-id="${escapeAttribute(category.id)}" value="${escapeAttribute(category.color || DEFAULT_CUSTOM_CATEGORY_COLOR)}" aria-label="分類色" />
          <button class="xtlo-settings-danger-icon" data-action="remove-category" data-category-id="${escapeAttribute(category.id)}" aria-label="分類を削除">
            ${getTrashIcon()}
          </button>
        </div>
      `).join('')
      : '<div class="xtlo-settings-empty">まだ分類はありません。</div>'

    return `
      <div class="xtlo-settings-category-manager">
        <div class="xtlo-settings-category-form">
          <input class="xtlo-settings-input" type="text" data-role="category-input" placeholder="分類名" aria-label="分類名" />
          <input class="xtlo-settings-color-input" type="color" data-role="category-color-input" value="${DEFAULT_CUSTOM_CATEGORY_COLOR}" aria-label="分類色" />
          <button class="xtlo-settings-primary" data-action="add-category">Add</button>
        </div>
        <div class="xtlo-settings-category-list">${rows}</div>
      </div>
    `
  }

  /**
   * 画面を再描画する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 現在タブから大分類と左側小項目ナビを描画する
   * 2. 現在タブに応じたリストや設定項目を右側へ描画する
   * 3. 件数とページ数からページネーション表示を更新する
   */
  function render () {
    if (!overlay) return

    ensureTabState(currentTab)

    const body = overlay.querySelector('.xtlo-settings-body')
    const footer = overlay.querySelector('.xtlo-settings-footer')
    const categoryKey = getCategoryKeyForTab(currentTab)
    const categoryButtons = overlay.querySelectorAll('.xtlo-settings-category-tab')

    categoryButtons.forEach(button => {
      button.dataset.active = String(button.dataset.category === categoryKey)
    })

    body.innerHTML = `
      <div class="xtlo-settings-layout">
        <div class="xtlo-settings-side-tabs">${renderSideTabs(categoryKey)}</div>
        <div class="xtlo-settings-content"></div>
      </div>
    `

    const content = body.querySelector('.xtlo-settings-content')

    if (currentTab === 'settings') {
      content.innerHTML = `
        <div class="xtlo-settings-settings-grid">
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">X の UI を非表示</div>
              <div class="xtlo-settings-toggle-desc">ヘッダーと投稿フォームを隠して、監視専用の表示に寄せます。</div>
            </div>
            <button class="xtlo-settings-switch" data-action="toggle-hide-ui" data-enabled="${String(config.hideUIEnabled)}" aria-label="UI 非表示切り替え"></button>
          </div>
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">タイムライン自動更新</div>
              <div class="xtlo-settings-toggle-desc">最上部にいるときだけ新着ポストの読み込みを自動で実行します。</div>
            </div>
            <button class="xtlo-settings-switch" data-action="toggle-auto-refresh" data-enabled="${String(config.autoRefreshEnabled)}" aria-label="自動更新切り替え"></button>
          </div>
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">設定ファイル</div>
              <div class="xtlo-settings-toggle-desc">現在のフィルターと設定を JSON で保存、または取り込みます。</div>
            </div>
            <div class="xtlo-settings-actions">
              <button class="xtlo-settings-secondary" data-action="export-config">エクスポート</button>
              <button class="xtlo-settings-secondary" data-action="import-config">インポート</button>
            </div>
          </div>
          <div class="xtlo-settings-hint">
            ポストID は 30 日で期限切れになります。メディアタブは現在保存済みのリスト名のみを編集でき、無効な名前の入力もそのまま保存されます。
          </div>
        </div>
      `

      footer.innerHTML = `
        <div></div>
        <div class="xtlo-settings-badge">${getFooterBadgeLabel('settings', 2)}</div>
      `
      return
    }

    if (currentTab === 'categorySettings') {
      content.innerHTML = renderCategorySettings()
      footer.innerHTML = `
        <div></div>
        <div class="xtlo-settings-badge">${getFooterBadgeLabel('categorySettings', config.customUserCategories.length)}</div>
      `
      return
    }

    const tabDefinition = getAllTabDefinitions().find(tab => tab.key === currentTab)
    const actions = getTabActions(currentTab)
    const listModel = getTabListModel(currentTab)
    const totalItems = listModel.rawItems.length
    const searchQuery = searchByTab[currentTab] ?? ''
    const filteredRawItems = filterRawItemsByQuery(listModel, searchQuery)
    const totalPages = Math.max(1, Math.ceil(filteredRawItems.length / PAGE_SIZE))
    const currentPage = Math.min(pageByTab[currentTab], totalPages)
    pageByTab[currentTab] = currentPage
    const startIndex = (currentPage - 1) * PAGE_SIZE
    const visibleItems = filteredRawItems
      .slice(startIndex, startIndex + PAGE_SIZE)
      .map(item => listModel.toItem(item))

    const listMarkup = visibleItems.length
      ? visibleItems
          .map(
            item => `
              <div class="xtlo-settings-card">
                <div class="xtlo-settings-icon">${getListIcon(currentTab)}</div>
                <div class="xtlo-settings-item-text">
                  <div class="xtlo-settings-item-title">${escapeHtml(item.title)}</div>
                  <div class="xtlo-settings-item-subtitle">${escapeHtml(item.subtitle)}</div>
                </div>
                <button class="xtlo-settings-danger-icon" data-action="remove-item" data-value="${escapeAttribute(item.value)}" aria-label="削除">
                  ${getTrashIcon()}
                </button>
              </div>
            `
          )
          .join('')
      : '<div class="xtlo-settings-empty">まだ項目はありません。</div>'

    content.innerHTML = `
      <div class="xtlo-settings-add-row">
        <input class="xtlo-settings-input" type="text" placeholder="${escapeAttribute(tabDefinition.placeholder)}" />
        <button class="xtlo-settings-primary" data-action="add-item">${actions.addLabel}</button>
      </div>
      <div class="xtlo-settings-search-row">
        <input class="xtlo-settings-search-input" type="search" data-role="search-input" value="${escapeAttribute(searchQuery)}" placeholder="登録済み項目を検索" aria-label="登録済み項目を検索" />
      </div>
      ${renderPagination(currentPage, totalPages)}
      <div class="xtlo-settings-list">${listMarkup}</div>
      ${renderPagination(currentPage, totalPages)}
    `

    footer.innerHTML = `
      <button class="xtlo-settings-clear" data-action="clear-all">${actions.clearLabel}</button>
      <div class="xtlo-settings-badge">${getFilteredFooterBadgeLabel(currentTab, filteredRawItems.length, totalItems)}</div>
    `
  }

  /**
   * 現在タブの入力欄を保存処理へ渡す。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 入力を trim してタブごとの形式へ正規化する
   * 2. 保存後にフィルタを再適用して再描画する
   */
  async function handleAddItem () {
    const body = overlay.querySelector('.xtlo-settings-body')
    const input = body.querySelector('.xtlo-settings-input')
    if (!input) return

    const rawValue = input.value.trim()
    if (!rawValue) return

    const actions = getTabActions(currentTab)
    const normalizedValue = actions.normalizeInput(rawValue)
    if (!normalizedValue) {
      alert('入力内容を解釈できませんでした')
      return
    }

    await actions.addItem(normalizedValue)
    input.value = ''
    reapplyFilters()
    render()
  }

  /**
   * 現在タブの項目を 1 件削除する。
   * 入力: data-value に入った保存値。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. タブに応じた削除関数を呼ぶ
   * 2. 再適用後に空ページへ残らないようページ番号も補正する
   */
  async function handleRemoveItem (value) {
    const actions = getTabActions(currentTab)
    await actions.removeItem(value)
    reapplyFilters()

    const remainingCount = filterRawItemsByQuery(
      getTabListModel(currentTab),
      searchByTab[currentTab] ?? ''
    ).length
    const maxPage = Math.max(1, Math.ceil(remainingCount / PAGE_SIZE))
    pageByTab[currentTab] = Math.min(pageByTab[currentTab], maxPage)
    render()
  }

  /**
   * 現在タブの項目を全削除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 確認ダイアログで誤操作を防ぐ
   * 2. タブごとの clearAll を実行して再描画する
   */

  /**
   * ユーザー定義分類を追加する。
   * 入力: 分類設定タブの分類名と色入力欄。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 分類名と色を読み取って保存コールバックへ渡す
   * 2. 作成後は分類設定タブを再描画する
   */
  async function handleAddCategory () {
    const input = overlay.querySelector('[data-role="category-input"]')
    if (!input) return

    const colorInput = overlay.querySelector('[data-role="category-color-input"]')
    const label = input.value.trim()
    const color = colorInput?.value || DEFAULT_CUSTOM_CATEGORY_COLOR
    if (!label) return

    const category = await addCustomUserCategory(label, color)
    if (!category) {
      alert('分類名が空、または既に登録済みです')
      return
    }

    input.value = ''
    if (colorInput) {
      colorInput.value = DEFAULT_CUSTOM_CATEGORY_COLOR
    }
    render()
  }

  /**
   * ユーザー定義分類を削除する。
   * 入力: 分類 ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 確認ダイアログで誤削除を防ぐ
   * 2. 削除中の分類タブを開いていた場合は分類設定タブへ戻す
   */
  async function handleRemoveCategory (categoryId) {
    const category = config.customUserCategories.find(item => item.id === categoryId)
    if (!category) return

    if (!confirm(`分類「${category.label}」を削除しますか？登録ユーザーもこの分類から削除されます。`)) {
      return
    }

    await removeCustomUserCategory(categoryId)
    reapplyFilters()
    if (currentTab === getCustomCategoryTabKey(categoryId)) {
      currentTab = 'categorySettings'
    }
    render()
  }


  /**
   * ユーザー定義分類の色変更を保存する。
   * 入力: 分類 ID と color input の値。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 選択された色を保存コールバックへ渡す
   * 2. 既存タイムラインの分類色を再適用する
   */
  async function handleSetCategoryColor (categoryId, color) {
    await setCustomUserCategoryColor(categoryId, color)
    reapplyFilters()
    render()
  }

  async function handleClearAll () {
    const actions = getTabActions(currentTab)
    if (actions.itemCount === 0) return

    if (!confirm('このタブの項目をすべて削除しますか？')) {
      return
    }

    await actions.clearAll()
    pageByTab[currentTab] = 1
    render()
  }

  /**
   * ページ入力欄の値を現在タブのページ番号へ反映する。
   * 入力: ページ入力欄の文字列。
   * 出力: なし。
   * 主な処理内容:
   * 1. 総ページ数を基準に不正値を 1..totalPages へ補正する
   * 2. 補正後の値を state と表示へ反映する
   */
  function applyPageInput (rawValue) {
    const filteredItems = filterRawItemsByQuery(
      getTabListModel(currentTab),
      searchByTab[currentTab] ?? ''
    )
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
    const normalizedPage = normalizePageNumber(rawValue, totalPages)

    pageByTab[currentTab] = normalizedPage
    render()
  }

  /**
   * 現在タブの検索語を更新して一覧を絞り込む。
   * 入力: 検索入力欄の文字列。
   * 出力: なし。
   * 主な処理内容:
   * 1. タブごとに検索語を保持する
   * 2. 検索結果が変わったとき空ページへ残らないようページ番号を 1 に戻す
   */
  function applySearchInput (rawValue) {
    searchByTab[currentTab] = rawValue
    pageByTab[currentTab] = 1
    render()

    const searchInput = overlay.querySelector('[data-role="search-input"]')
    if (searchInput) {
      searchInput.focus()
      searchInput.setSelectionRange(rawValue.length, rawValue.length)
    }
  }

  /**
   * ダイアログ内クリックをイベント委譲で処理する。
   * 入力: click イベント。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 再描画でボタンが差し替わってもリスナーを張り直さずに済むよう data-action を読む
   * 2. タブ切り替え、追加、削除、設定トグルを振り分ける
   */
  async function handleOverlayClick (event) {
    if (event.target === overlay) {
      close()
      return
    }

    const target = event.target.closest(
      '[data-action], .xtlo-settings-category-tab, .xtlo-settings-side-tab, .xtlo-settings-close'
    )
    if (!target) return

    if (target.classList.contains('xtlo-settings-close')) {
      close()
      return
    }

    if (target.classList.contains('xtlo-settings-category-tab')) {
      currentTab = getDefaultTabForCategory(target.dataset.category)
      render()
      return
    }

    if (target.classList.contains('xtlo-settings-side-tab')) {
      currentTab = target.dataset.tab
      render()
      return
    }

    const { action } = target.dataset
    if (!action) return

    if (action === 'add-item') {
      await handleAddItem()
      return
    }

    if (action === 'remove-item') {
      await handleRemoveItem(target.dataset.value)
      return
    }

    if (action === 'add-category') {
      await handleAddCategory()
      return
    }

    if (action === 'remove-category') {
      await handleRemoveCategory(target.dataset.categoryId)
      return
    }

    if (action === 'clear-all') {
      await handleClearAll()
      return
    }

    if (action === 'prev-page') {
      pageByTab[currentTab] = Math.max(1, pageByTab[currentTab] - 1)
      render()
      return
    }

    if (action === 'next-page') {
      pageByTab[currentTab] += 1
      render()
      return
    }

    if (action === 'toggle-hide-ui') {
      const nextValue = !config.hideUIEnabled
      setHideUI(nextValue)
      await setHideUIEnabled(nextValue)
      render()
      return
    }

    if (action === 'toggle-auto-refresh') {
      const nextValue = !config.autoRefreshEnabled
      applyAutoRefreshEnabled(nextValue)
      await setAutoRefreshEnabled(nextValue)
      render()
      return
    }

    if (action === 'export-config') {
      exportConfigToFile()
      return
    }

    if (action === 'import-config') {
      await importConfigFromFile()
      render()
    }
  }

  /**
   * Enter キーで追加できるように入力欄のキー入力を処理する。
   * 入力: keydown イベント。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 入力欄で Enter が押されたときだけ追加処理を呼ぶ
   */
  async function handleOverlayKeydown (event) {
    if (event.key === 'Escape') {
      close()
      return
    }

    if (
      event.key === 'Enter' &&
      event.target.dataset.role === 'category-input'
    ) {
      event.preventDefault()
      await handleAddCategory()
      return
    }

    if (
      event.key === 'Enter' &&
      event.target.classList.contains('xtlo-settings-input')
    ) {
      event.preventDefault()
      await handleAddItem()
      return
    }

    if (
      event.key === 'Enter' &&
      event.target.dataset.role === 'page-input'
    ) {
      event.preventDefault()
      applyPageInput(event.target.value)
    }
  }

  /**
   * change イベントからページ入力欄や分類色の変更を反映する。
   * 入力: change イベント。
   * 出力: なし。
   * 主な処理内容:
   * 1. 分類色の変更は保存してタイムラインへ再適用する
   * 2. ページ入力欄は不正値を補正して再描画する
   */
  function handleOverlayChange (event) {
    if (event.target.dataset.action === 'set-category-color') {
      handleSetCategoryColor(event.target.dataset.categoryId, event.target.value).catch(error => {
        console.error('[X-Observer] 分類色の変更に失敗しました:', error)
        alert(`分類色の変更に失敗しました: ${error.message}`)
      })
      return
    }

    if (event.target.dataset.role === 'page-input') {
      applyPageInput(event.target.value)
      return
    }

    if (event.target.dataset.role === 'search-input') {
      applySearchInput(event.target.value)
    }
  }

  /**
   * input イベントから検索欄の入力を即時反映する。
   * 入力: input イベント。
   * 出力: なし。
   * 主な処理内容:
   * 1. 検索欄の入力だけを拾う
   * 2. 入力途中でも一覧を絞り込めるよう即時再描画する
   */
  function handleOverlayInput (event) {
    if (event.target.dataset.role !== 'search-input') {
      return
    }

    applySearchInput(event.target.value)
  }

  /**
   * ダイアログ DOM を生成して body へ挿入する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 初回にだけ overlay を作成する
   * 2. クリックとキー入力のリスナーを委譲で登録する
   */
  function ensureOverlay () {
    if (overlay) return

    overlay = document.createElement('div')
    overlay.className = 'xtlo-settings-overlay'
    overlay.innerHTML = `
      <div class="xtlo-settings-dialog" role="dialog" aria-modal="true" aria-label="X-Observer 設定">
        <div class="xtlo-settings-header">
          <div class="xtlo-settings-header-row">
            <div class="xtlo-settings-title">X-Observer</div>
            <button class="xtlo-settings-close" aria-label="閉じる">×</button>
          </div>
          <div class="xtlo-settings-category-tabs">
            ${CATEGORY_DEFINITIONS.map(category => `
              <button class="xtlo-settings-category-tab" data-category="${category.key}" data-active="false">${category.label}</button>
            `).join('')}
          </div>
        </div>
        <div class="xtlo-settings-body"></div>
        <div class="xtlo-settings-footer"></div>
      </div>
    `

    overlay.addEventListener('click', event => {
      handleOverlayClick(event).catch(error => {
        console.error('[X-Observer] 設定ダイアログ操作に失敗しました:', error)
        alert(`設定ダイアログ操作に失敗しました: ${error.message}`)
      })
    })
    overlay.addEventListener('keydown', event => {
      handleOverlayKeydown(event).catch(error => {
        console.error('[X-Observer] 設定ダイアログ入力処理に失敗しました:', error)
        alert(`設定ダイアログ入力処理に失敗しました: ${error.message}`)
      })
    })
    overlay.addEventListener('change', event => {
      try {
        handleOverlayChange(event)
      } catch (error) {
        console.error('[X-Observer] 設定ダイアログのページ変更に失敗しました:', error)
        alert(`設定ダイアログのページ変更に失敗しました: ${error.message}`)
      }
    })
    overlay.addEventListener('input', event => {
      try {
        handleOverlayInput(event)
      } catch (error) {
        console.error('[X-Observer] 設定ダイアログの検索に失敗しました:', error)
        alert(`設定ダイアログの検索に失敗しました: ${error.message}`)
      }
    })
  }

  /**
   * ダイアログを開く。
   * 入力: 開きたいタブキー。省略時は現在タブを維持。
   * 出力: なし。
   * 主な処理内容:
   * 1. スタイルと DOM を準備する
   * 2. body へ追加して描画する
   * 3. 最初の入力欄へフォーカスする
   */
  function open (tabKey = currentTab) {
    currentTab = tabKey
    ensureTabState(currentTab)
    ensureStyle()
    ensureOverlay()
    if (!overlay.isConnected) {
      document.body.appendChild(overlay)
    }
    render()
    overlay.tabIndex = -1
    overlay.focus()

    const input = overlay.querySelector('.xtlo-settings-input')
    if (input) {
      input.focus()
    }
  }

  /**
   * ダイアログを閉じる。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. overlay を DOM から外す
   */
  function close () {
    overlay?.remove()
  }

  return {
    open,
    close
  }
}

/**
 * HTML として埋め込む文字列をエスケープする。
 * 入力: 任意の文字列。
 * 出力: 安全な HTML 文字列。
 * 主な処理内容:
 * 1. innerHTML へ入れる値の記号を実体参照へ置換する
 */
function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 属性値へ入れる文字列をエスケープする。
 * 入力: 任意の文字列。
 * 出力: 属性値として安全な文字列。
 * 主な処理内容:
 * 1. 本実装では HTML エスケープと同じ規則で十分なため共通化する
 */
function escapeAttribute (value) {
  return escapeHtml(value)
}
