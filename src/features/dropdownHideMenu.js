import { extractPostInfo } from '../extractors/postExtractor.js'

/**
 * X 標準ドロップダウンを React の onDismiss 経由で閉じる。
 * 入力: role="menu" の要素
 * 出力: なし
 * 主な処理内容: role="group" から React Fiber をたどり、onDismiss を呼び出す
 */
function closeDropdownMenu (menu) {
  const groupEl = menu.closest('[role="group"]')
  if (!groupEl) return

  const fiberKey = Object.keys(groupEl).find(key =>
    key.startsWith('__reactFiber$')
  )
  if (!fiberKey) return

  let fiber = groupEl[fiberKey]
  for (let i = 0; i < 15 && fiber; i++) {
    const props = fiber.memoizedProps || {}
    if (typeof props.onDismiss === 'function') {
      props.onDismiss()
      return
    }
    fiber = fiber.return
  }
}

/**
 * 投稿の「...」メニューへ独自の非表示項目を注入する監視を開始する。
 * 入力: 非表示登録関数と再適用関数
 * 出力: MutationObserver
 * 主な処理内容:
 * 1. 直前に押された caret を記録する
 * 2. menu 出現を監視する
 * 3. 対象投稿の statusId を使って独自 menuitem を注入する
 */
export function setupDropdownHideMenu ({ addHiddenStatus, reapplyFilters }) {
  // X 標準メニューは「どの投稿から開いたか」を直接渡してこないため、直前クリックを手掛かりにする。
  let lastClickedCaret = null

  document.addEventListener(
    'click',
    event => {
      const caretButton = event.target.closest('[data-testid="caret"]')
      if (caretButton) {
        lastClickedCaret = caretButton
      }
    },
    true
  )

  /**
   * 対象 menu へ「このポストを非表示」項目を差し込む。
   * 入力: role="menu" の要素
   * 出力: なし
   * 主な処理内容: 直前 caret に対応する article を見つけ、クリック時に非表示登録する
   */
  function injectHideMenuItem (menu) {
    if (menu.querySelector('.xtlo-hide-post-menuitem')) return
    if (!lastClickedCaret) return

    const article = lastClickedCaret.closest('article')
    if (!article) return

    const info = extractPostInfo(article)
    if (!info.statusId) return

    const menuItem = document.createElement('div')
    menuItem.setAttribute('role', 'menuitem')
    menuItem.setAttribute('tabindex', '0')
    menuItem.className = 'xtlo-hide-post-menuitem'
    menuItem.innerHTML = `
      <div class="xtlo-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g>
            <path d="M3.693 21.707l-1.414-1.414 2.429-2.429c-2.479-2.421-3.606-5.376-3.658-5.513l-.131-.352.131-.352c.133-.353 3.331-8.648 10.937-8.648 2.062 0 3.834.629 5.332 1.644l2.674-2.674 1.414 1.414L3.693 21.707zm-.622-9.706c.356.797 1.354 2.794 3.051 4.449l2.417-2.418c-.361-.609-.553-1.306-.553-2.032 0-2.206 1.794-4 4-4 .727 0 1.424.192 2.033.554l2.263-2.264C14.953 5.434 13.512 5 11.986 5c-5.416 0-8.258 5.535-8.915 7.001zM11.986 10c-1.103 0-2 .897-2 2 0 .441.144.861.41 1.207l2.798-2.797C12.847 10.144 12.427 10 11.986 10zm9.878 7.06l-1.5-1.5c1.094-1.222 1.858-2.534 2.264-3.56-.869-1.907-3.813-7.001-8.642-7.001-.796 0-1.542.124-2.238.332l-1.63-1.63C11.064 3.241 12.136 3 13.271 3c6.256 0 9.573 6.971 9.778 7.432l.151.354-.108.341c-.148.465-1.065 2.893-2.928 4.933z"></path>
          </g>
        </svg>
      </div>
      <div class="xtlo-label">このポストを非表示 (X-Observer)</div>
    `

    menuItem.addEventListener('click', async event => {
      event.preventDefault()
      event.stopPropagation()

      const dropdownMenu = menuItem.closest('[role="menu"]')

      await addHiddenStatus(info.statusId)
      reapplyFilters()

      if (dropdownMenu) {
        // X 側のメニュー管理状態を壊さず閉じるため、DOM 削除ではなく onDismiss を呼ぶ。
        closeDropdownMenu(dropdownMenu)
      }

      console.log(
        `[X-Observer] メニューからポストを非表示にしました: ${info.statusId}`
      )
    })

    menu.appendChild(menuItem)
  }

  // X 側メニューの構築完了前に挿入すると位置や構造が崩れるため、出現監視 + 少し遅延で差し込む。
  const menuObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue

        const menus = []
        if (node.getAttribute && node.getAttribute('role') === 'menu') {
          menus.push(node)
        }
        if (node.querySelectorAll) {
          menus.push(...node.querySelectorAll('[role="menu"]'))
        }
        for (const menu of menus) {
          setTimeout(() => injectHideMenuItem(menu), 50)
        }
      }
    }
  })

  menuObserver.observe(document.body, {
    childList: true,
    subtree: true
  })

  return menuObserver
}
