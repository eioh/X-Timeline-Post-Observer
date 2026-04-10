/**
 * 現在アクティブなタイムラインタブ名を返す。
 * 入力: なし
 * 出力: タブ名文字列。取得できない場合は null
 * 主な処理内容: role 属性と aria-selected を使って X のタブ選択状態を読む
 */
export function getActiveTabName () {
  const activeTab = document.querySelector(
    '[role="tablist"] [role="tab"][aria-selected="true"]'
  )
  return activeTab ? activeTab.textContent.trim() : null
}

/**
 * 引用カードの React Fiber から引用先 statusId を探す。
 * 入力: 引用カード相当の DOM 要素
 * 出力: 引用先 statusId。取れない場合は null
 * 主な処理内容: Fiber を親方向へたどり、link.pathname から /status/<数字> を抜き出す
 */
function getQuoteStatusIdFromFiber (quoteDivElement) {
  const fiberKey = Object.keys(quoteDivElement).find(key =>
    key.startsWith('__reactFiber$')
  )
  if (!fiberKey) return null

  let fiber = quoteDivElement[fiberKey]
  for (let i = 0; i < 15 && fiber; i++) {
    const props = fiber.memoizedProps || {}
    if (props.link && typeof props.link === 'object' && props.link.pathname) {
      const match = props.link.pathname.match(/\/status\/(\d+)/)
      if (match) return match[1]
    }
    fiber = fiber.return
  }

  return null
}

/**
 * DOM 内リンクから引用先 statusId を探す。
 * 入力: 元 article 要素、引用ユーザー ID
 * 出力: 引用先 statusId。取れない場合は null
 * 主な処理内容: 該当ユーザーの /status/ リンクを総当たりで探す
 */
function getQuoteStatusIdFromDOM (article, quoteUserId) {
  if (!quoteUserId) return null

  const links = article.querySelectorAll('a[href*="/status/"]')
  for (const link of links) {
    const href = link.getAttribute('href')
    if (href.includes('/' + quoteUserId + '/status/')) {
      const match = href.match(/\/status\/(\d+)/)
      if (match) return match[1]
    }
  }

  return null
}

/**
 * tweetText 要素から、画面表示に近い本文文字列を再構築する。
 * 入力: tweetText 要素
 * 出力: 復元した本文文字列
 * 主な処理内容:
 * 1. TextNode をそのまま連結する
 * 2. 絵文字画像は alt 属性で復元する
 * 3. 外部URLは title 属性を優先して展開先 URL を採用する
 */
function getFullVisibleText (element) {
  let text = ''

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'IMG') {
        text += node.getAttribute('alt') || ''
      } else if (node.tagName === 'A') {
        const href = node.getAttribute('href') || ''
        const title = node.getAttribute('title')
        if (title && href.startsWith('http')) {
          // t.co 短縮リンクをそのまま判定するとワードフィルタが外れるため、展開先URLを採用する。
          text += title
        } else {
          text += getFullVisibleText(node)
        }
      } else {
        text += getFullVisibleText(node)
      }
    }
  }

  return text
}

/**
 * 引用投稿部分の情報を抽出する。
 * 入力: 親 article 要素、引用カード要素
 * 出力: 引用投稿の userId / statusId / 本文 / メディア有無
 * 主な処理内容: 引用カード内の本文・アバター・メディアと、引用先 ID をまとめて読む
 */
function extractQuoteInfo (article, quoteDivElement) {
  const avatarEl = quoteDivElement.querySelector(
    '[data-testid^="UserAvatar-Container-"]'
  )
  const userId = avatarEl
    ? avatarEl.getAttribute('data-testid').replace('UserAvatar-Container-', '')
    : null

  const tweetTextEl = quoteDivElement.querySelector('[data-testid="tweetText"]')
  const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : ''

  const hasImages =
    quoteDivElement.querySelectorAll('[data-testid="tweetPhoto"]').length > 0
  const hasVideos =
    quoteDivElement.querySelectorAll(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
    ).length > 0

  const statusId =
    getQuoteStatusIdFromFiber(quoteDivElement) ||
    getQuoteStatusIdFromDOM(article, userId)

  return {
    statusId: statusId || null,
    userId,
    text,
    hasImages,
    hasVideos,
    hasMedia: hasImages || hasVideos
  }
}

/**
 * タイムライン上の article から投稿情報を抽出する。
 * 入力: article 要素
 * 出力: statusId / userId / 本文 / メディア有無 / 引用情報を含むオブジェクト
 * 主な処理内容:
 * 1. 投稿 ID とユーザー ID を取る
 * 2. 本文を見た目に近い形で復元する
 * 3. 引用投稿内メディアを差し引いたうえで自前メディアを判定する
 */
export function extractPostInfo (article) {
  const statusLink = article.querySelector('a[href*="/status/"]')
  let statusId = null
  if (statusLink) {
    const match = statusLink.getAttribute('href').match(/\/status\/(\d+)/)
    if (match) statusId = match[1]
  }

  const avatarEl = article.querySelector('[data-testid^="UserAvatar-Container-"]')
  const userId = avatarEl
    ? avatarEl.getAttribute('data-testid').replace('UserAvatar-Container-', '')
    : null

  const tweetTextEl = article.querySelector('[data-testid="tweetText"]')
  const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : ''

  const quoteDivElement = article.querySelector('div[role="link"][tabindex="0"]')
  const totalPhotos = article.querySelectorAll('[data-testid="tweetPhoto"]').length
  const totalVideos = article.querySelectorAll(
    '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
  ).length

  let quotePhotos = 0
  let quoteVideos = 0
  if (quoteDivElement) {
    quotePhotos = quoteDivElement.querySelectorAll('[data-testid="tweetPhoto"]').length
    quoteVideos = quoteDivElement.querySelectorAll(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"]'
    ).length
  }

  // 引用ポスト内メディアを差し引かないと、本文だけの引用投稿までメディア付き扱いになる。
  const hasImages = totalPhotos - quotePhotos > 0
  const hasVideos = totalVideos - quoteVideos > 0
  const quote = quoteDivElement ? extractQuoteInfo(article, quoteDivElement) : null

  return {
    statusId,
    userId,
    text,
    hasImages,
    hasVideos,
    hasMedia: hasImages || hasVideos,
    quote
  }
}
