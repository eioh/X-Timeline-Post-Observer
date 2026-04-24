import { extractPostInfo } from '../extractors/postExtractor.js'


/**
 * HTML へ埋め込む文字列をエスケープする。
 * 入力: 表示したい文字列。
 * 出力: HTML として解釈されない安全な文字列。
 * 主な処理内容:
 * 1. ユーザー定義分類名が DOM 構造を壊さないよう特殊文字を置き換える
 */
function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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
 * X 標準メニューへ差し込む独自 menuitem 要素を組み立てる。
 * 入力: 一意なクラス名、表示ラベル、クリック時の処理
 * 出力: role="menuitem" を持つ div 要素
 * 主な処理内容: X 標準メニューへなじむ共通 DOM 構造とイベント処理をまとめる
 */
function createDropdownMenuItem ({ className, label, onSelect }) {
  const menuItem = document.createElement('div')
  menuItem.setAttribute('role', 'menuitem')
  menuItem.setAttribute('tabindex', '0')
  menuItem.className = className
  menuItem.innerHTML = `
    <div class="xtlo-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <g>
          <path d="M3.693 21.707l-1.414-1.414 2.429-2.429c-2.479-2.421-3.606-5.376-3.658-5.513l-.131-.352.131-.352c.133-.353 3.331-8.648 10.937-8.648 2.062 0 3.834.629 5.332 1.644l2.674-2.674 1.414 1.414L3.693 21.707zm-.622-9.706c.356.797 1.354 2.794 3.051 4.449l2.417-2.418c-.361-.609-.553-1.306-.553-2.032 0-2.206 1.794-4 4-4 .727 0 1.424.192 2.033.554l2.263-2.264C14.953 5.434 13.512 5 11.986 5c-5.416 0-8.258 5.535-8.915 7.001zM11.986 10c-1.103 0-2 .897-2 2 0 .441.144.861.41 1.207l2.798-2.797C12.847 10.144 12.427 10 11.986 10zm9.878 7.06l-1.5-1.5c1.094-1.222 1.858-2.534 2.264-3.56-.869-1.907-3.813-7.001-8.642-7.001-.796 0-1.542.124-2.238.332l-1.63-1.63C11.064 3.241 12.136 3 13.271 3c6.256 0 9.573 6.971 9.778 7.432l.151.354-.108.341c-.148.465-1.065 2.893-2.928 4.933z"></path>
        </g>
      </svg>
    </div>
    <div class="xtlo-label">${escapeHtml(label)}</div>
  `

  menuItem.addEventListener('click', async event => {
    event.preventDefault()
    event.stopPropagation()
    await onSelect(menuItem)
  })

  return menuItem
}

/**
 * 投稿の「...」メニューへ独自の非表示項目を注入する監視を開始する。
 * 入力: 投稿・ユーザーの非表示登録関数、分類登録関数、現在設定、再適用関数
 * 出力: MutationObserver
 * 主な処理内容:
 * 1. 直前に押された caret を記録する
 * 2. menu 出現を監視する
 * 3. 対象投稿の statusId / userId を使って独自 menuitem を注入する
 * 4. ユーザー定義分類があれば分類追加項目も注入する
 */
export function setupDropdownHideMenu ({
  addHiddenStatus,
  addHiddenUser,
  addFollowUser,
  addListUser,
  addCustomCategoryUser,
  config,
  reapplyFilters
}) {
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
   * 対象 menu へ追加分類や非表示の独自項目を差し込む。
   * 入力: role="menu" の要素
   * 出力: なし
   * 主な処理内容:
   * 1. 直前 caret に対応する article を見つける
   * 2. ユーザー ID があればフォロー、リスト、ユーザー定義分類、ユーザー非表示を追加する
   * 3. 投稿 ID があればポスト非表示を追加する
   */
  function injectHideMenuItem (menu) {
    if (
      menu.querySelector('.xtlo-hide-post-menuitem') ||
      menu.querySelector('.xtlo-hide-user-menuitem')
    ) {
      return
    }
    if (!lastClickedCaret) return

    const article = lastClickedCaret.closest('article')
    if (!article) return

    const info = extractPostInfo(article)
    if (!info.statusId && !info.userId) return

    if (info.userId) {
      menu.appendChild(
        createDropdownMenuItem({
          className: 'xtlo-hide-post-menuitem',
          label: `フォローとして追加 (@${info.userId})`,
          onSelect: async menuItem => {
            const dropdownMenu = menuItem.closest('[role="menu"]')

            await addFollowUser(info.userId)
            reapplyFilters()

            if (dropdownMenu) {
              closeDropdownMenu(dropdownMenu)
            }

            console.log(
              `[X-Observer] メニューからフォローユーザーを追加しました: @${info.userId}`
            )
          }
        })
      )

      menu.appendChild(
        createDropdownMenuItem({
          className: 'xtlo-hide-post-menuitem',
          label: `リストインとして追加 (@${info.userId})`,
          onSelect: async menuItem => {
            const dropdownMenu = menuItem.closest('[role="menu"]')

            await addListUser(info.userId)
            reapplyFilters()

            if (dropdownMenu) {
              closeDropdownMenu(dropdownMenu)
            }

            console.log(
              `[X-Observer] メニューからリストインユーザーを追加しました: @${info.userId}`
            )
          }
        })
      )

      for (const category of config.customUserCategories) {
        menu.appendChild(
          createDropdownMenuItem({
            className: 'xtlo-hide-post-menuitem',
            label: `分類「${category.label}」に追加 (@${info.userId})`,
            onSelect: async menuItem => {
              const dropdownMenu = menuItem.closest('[role="menu"]')

              await addCustomCategoryUser(category.id, info.userId)
              reapplyFilters()

              if (dropdownMenu) {
                closeDropdownMenu(dropdownMenu)
              }

              console.log(
                `[X-Observer] メニューから${category.label}分類へユーザーを追加しました: @${info.userId}`
              )
            }
          })
        )
      }

      menu.appendChild(
        createDropdownMenuItem({
          className: 'xtlo-hide-user-menuitem xtlo-hide-post-menuitem',
          label: `ユーザーを非表示 (@${info.userId})`,
          onSelect: async menuItem => {
            const dropdownMenu = menuItem.closest('[role="menu"]')

            await addHiddenUser(info.userId)
            reapplyFilters()

            if (dropdownMenu) {
              // ユーザー追加後も X 標準メニューの閉じ方を揃え、開閉状態の不整合を避ける。
              closeDropdownMenu(dropdownMenu)
            }

            console.log(
              `[X-Observer] メニューからユーザーを非表示にしました: @${info.userId}`
            )
          }
        })
      )
    }

    if (info.statusId) {
      menu.appendChild(
        createDropdownMenuItem({
          className: 'xtlo-hide-post-menuitem',
          label: 'ポストを非表示',
          onSelect: async menuItem => {
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
          }
        })
      )
    }
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
