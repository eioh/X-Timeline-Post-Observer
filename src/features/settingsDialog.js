import { config } from '../state/configStore.js'

const PAGE_SIZE = 500
const TAB_DEFINITIONS = [
  {
    key: 'users',
    label: 'ユーザーID',
    placeholder: '[@]user_id'
  },
  {
    key: 'statuses',
    label: 'ポストID',
    placeholder: 'post_id / URL'
  },
  {
    key: 'words',
    label: 'キーワード',
    placeholder: 'keyword'
  },
  {
    key: 'media',
    label: 'メディア',
    placeholder: 'リスト名'
  },
  {
    key: 'settings',
    label: '設定',
    placeholder: ''
  }
]

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
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 10px;
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

  .xtlo-settings-tabs {
    display: flex;
    gap: 18px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-tab {
    position: relative;
    padding: 8px 0 10px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-tab[data-active="true"] {
    color: #ffffff;
  }

  .xtlo-settings-tab[data-active="true"]::after {
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

  .xtlo-settings-input::placeholder {
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

    .xtlo-settings-tabs {
      gap: 20px;
      overflow: auto;
    }

    .xtlo-settings-add-row,
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
 * 設定配列をタブごとの一覧データへ変換する。
 * 入力: タブキー。
 * 出力: 表示用アイテム配列。
 * 主な処理内容:
 * 1. config の保存形式を UI 用の title / subtitle へ整形する
 * 2. hiddenStatuses だけは期限日時も添えて表示する
 */
function getItemsForTab (tabKey) {
  if (tabKey === 'users') {
    return config.hiddenUserIds.map(value => ({
      value,
      title: `@${value}`,
      subtitle: 'ユーザーID'
    }))
  }

  if (tabKey === 'statuses') {
    return config.hiddenStatuses.map(entry => ({
      value: entry.statusId,
      title: entry.statusId,
      subtitle: `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
    }))
  }

  if (tabKey === 'words') {
    return config.hiddenWords.map(value => ({
      value,
      title: value,
      subtitle: 'キーワード'
    }))
  }

  return config.mediaFilterLists.map(value => ({
    value,
    title: value,
    subtitle: 'メディアフィルタ'
  }))
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
    statuses: 1,
    words: 1,
    media: 1,
    settings: 1
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
        items: getItemsForTab(tabKey),
        addLabel: 'Add',
        clearLabel: 'Clear all users',
        totalLabel: 'Active Filters',
        addItem: async value => addHiddenUser(value),
        removeItem: async value => removeHiddenUser(value),
        clearAll: async () => {
          for (const value of [...config.hiddenUserIds]) {
            await removeHiddenUser(value)
          }
          reapplyFilters()
        },
        normalizeInput: value => value.replace(/^@/, '')
      }
    }

    if (tabKey === 'statuses') {
      return {
        items: getItemsForTab(tabKey),
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
        items: getItemsForTab(tabKey),
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
      items: getItemsForTab(tabKey),
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
    if (tabKey === 'settings') {
      return `${count} Settings`
    }
    return `${count} Active Filters`
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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 5h12v2H6zm0 6h12v2H6zm0 6h8v2H6z"/>
        </svg>
      `
    }

    if (tabKey === 'words') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5 5h14v2H5zm0 4h14v2H5zm0 4h9v2H5zm0 4h7v2H5z"/>
        </svg>
      `
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8zm2 1h4v2H8zm0 3h8v2H8z"/>
      </svg>
    `
  }

  /**
   * 画面を再描画する。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 現在タブに応じたリストや設定項目を描画する
   * 2. 件数とページ数からページネーション表示を更新する
   */
  function render () {
    if (!overlay) return

    const body = overlay.querySelector('.xtlo-settings-body')
    const footer = overlay.querySelector('.xtlo-settings-footer')
    const tabButtons = overlay.querySelectorAll('.xtlo-settings-tab')

    tabButtons.forEach(button => {
      button.dataset.active = String(button.dataset.tab === currentTab)
    })

    if (currentTab === 'settings') {
      body.innerHTML = `
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

    const tabDefinition = TAB_DEFINITIONS.find(tab => tab.key === currentTab)
    const actions = getTabActions(currentTab)
    const totalItems = actions.items.length
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
    const currentPage = Math.min(pageByTab[currentTab], totalPages)
    pageByTab[currentTab] = currentPage
    const startIndex = (currentPage - 1) * PAGE_SIZE
    const visibleItems = actions.items.slice(startIndex, startIndex + PAGE_SIZE)

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

    body.innerHTML = `
      <div class="xtlo-settings-add-row">
        <input class="xtlo-settings-input" type="text" placeholder="${escapeAttribute(tabDefinition.placeholder)}" />
        <button class="xtlo-settings-primary" data-action="add-item">${actions.addLabel}</button>
      </div>
      <div class="xtlo-settings-list">${listMarkup}</div>
      <div class="xtlo-settings-pagination">
        <button class="xtlo-settings-page-btn" data-action="prev-page" ${currentPage <= 1 ? 'disabled' : ''} aria-label="前のページ">‹</button>
        <div class="xtlo-settings-page-indicator">
          <input class="xtlo-settings-page-current" data-role="page-input" inputmode="numeric" value="${currentPage}" aria-label="現在のページ" />
          <div>/ ${totalPages}</div>
        </div>
        <button class="xtlo-settings-page-btn" data-action="next-page" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="次のページ">›</button>
      </div>
    `

    footer.innerHTML = `
      <button class="xtlo-settings-clear" data-action="clear-all">${actions.clearLabel}</button>
      <div class="xtlo-settings-badge">${getFooterBadgeLabel(currentTab, totalItems)}</div>
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

    const remainingCount = getItemsForTab(currentTab).length
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
  async function handleClearAll () {
    const actions = getTabActions(currentTab)
    if (actions.items.length === 0) return

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
    const totalItems = getTabActions(currentTab).items.length
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
    const normalizedPage = normalizePageNumber(rawValue, totalPages)

    pageByTab[currentTab] = normalizedPage
    render()
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

    const target = event.target.closest('[data-action], .xtlo-settings-tab, .xtlo-settings-close')
    if (!target) return

    if (target.classList.contains('xtlo-settings-close')) {
      close()
      return
    }

    if (target.classList.contains('xtlo-settings-tab')) {
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
   * change イベントからページ入力欄の変更を反映する。
   * 入力: change イベント。
   * 出力: なし。
   * 主な処理内容:
   * 1. ページ入力欄の変更だけを拾う
   * 2. 不正値を補正して再描画する
   */
  function handleOverlayChange (event) {
    if (event.target.dataset.role !== 'page-input') {
      return
    }

    applyPageInput(event.target.value)
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
          <div class="xtlo-settings-title">X-Observer</div>
          <button class="xtlo-settings-close" aria-label="閉じる">×</button>
        </div>
        <div class="xtlo-settings-tabs">
          ${TAB_DEFINITIONS.map(
            tab => `
              <button class="xtlo-settings-tab" data-tab="${tab.key}" data-active="false">${tab.label}</button>
            `
          ).join('')}
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
