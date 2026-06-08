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
 * 現在の画面がホームタイムラインかどうかを判定する。
 * 入力: なし
 * 出力: ホームタイムラインなら true
 * 主な処理内容:
 * 1. パス名を正規化して末尾スラッシュ差を吸収する
 * 2. /home のときだけ true を返す
 */
export function isHomeTimelinePage () {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  return normalizedPath === '/home'
}

/**
 * 数字だけのユーザー内部 ID として使える文字列を返す。
 * 入力: 任意の値。
 * 出力: 数字文字列。該当しない場合は null。
 * 主な処理内容: X の User.rest_id / legacy.id_str 由来の値だけを候補にする
 */
function normalizeInternalUserId (value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const normalized = String(value).trim()
  return /^\d+$/.test(normalized) ? normalized : null
}

/**
 * React の値が対象スクリーン名の User オブジェクトなら内部 ID を返す。
 * 入力: React props 内の任意オブジェクト、画面表示のユーザー ID。
 * 出力: ユーザー内部 ID。取れない場合は null。
 * 主な処理内容:
 * 1. User 型または screen_name を持つ構造だけを対象にする
 * 2. 投稿 ID など別種の数字を拾わないようスクリーン名一致を確認する
 */
function getInternalUserIdFromUserObject (value, expectedUserId) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const screenName = value.legacy?.screen_name || value.screen_name || value.screenName
  const isUserLike =
    value.__typename === 'User' ||
    value.typename === 'User' ||
    typeof screenName === 'string'
  const normalizedScreenName = typeof screenName === 'string'
    ? screenName.toLowerCase()
    : null
  const normalizedExpected = expectedUserId
    ? expectedUserId.toLowerCase()
    : null

  if (
    !isUserLike ||
    (normalizedExpected && normalizedScreenName !== normalizedExpected)
  ) {
    return null
  }

  return (
    normalizeInternalUserId(value.rest_id) ||
    normalizeInternalUserId(value.id_str) ||
    normalizeInternalUserId(value.legacy?.id_str)
  )
}

/**
 * React props / Fiber の中から対象ユーザーの内部 ID を探す。
 * 入力: 探索対象の値、画面表示のユーザー ID、探索状態。
 * 出力: ユーザー内部 ID。取れない場合は null。
 * 主な処理内容:
 * 1. 循環参照を避けながら浅めに再帰探索する
 * 2. User オブジェクトと判定できる箇所だけから数字 ID を抜き出す
 */
function findInternalUserIdInReactValue (
  value,
  expectedUserId,
  depth = 0,
  seen = new WeakSet()
) {
  if (!value || typeof value !== 'object' || depth > 8) {
    return null
  }

  if (seen.has(value)) {
    return null
  }
  seen.add(value)

  const directUserId = getInternalUserIdFromUserObject(value, expectedUserId)
  if (directUserId) {
    return directUserId
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'stateNode' || key === 'return' || key === 'child' || key === 'sibling') {
      continue
    }

    const found = findInternalUserIdInReactValue(
      childValue,
      expectedUserId,
      depth + 1,
      seen
    )
    if (found) {
      return found
    }
  }

  return null
}

/**
 * DOM 要素に紐づく React データから対象ユーザーの内部 ID を取得する。
 * 入力: DOM 要素、画面表示のユーザー ID。
 * 出力: ユーザー内部 ID。取れない場合は null。
 * 主な処理内容:
 * 1. React props / Fiber の隠しキーを探す
 * 2. props と memoizedProps から対象ユーザーの User オブジェクトを探索する
 * 3. Fiber の親方向にも候補データが載るため、return チェーンを浅く確認する
 */
function getUserInternalIdFromReactData (element, userId) {
  if (!element || !userId) {
    return null
  }

  const reactKeys = Object.keys(element).filter(key =>
    key.startsWith('__reactProps$') || key.startsWith('__reactFiber$')
  )

  for (const key of reactKeys) {
    const reactValue = element[key]
    const found =
      findInternalUserIdInReactValue(reactValue?.memoizedProps, userId) ||
      findInternalUserIdInReactValue(reactValue?.pendingProps, userId) ||
      findInternalUserIdInReactValue(reactValue, userId)

    if (found) {
      return found
    }

    if (key.startsWith('__reactFiber$')) {
      let fiber = reactValue?.return
      for (let i = 0; i < 20 && fiber; i++) {
        const foundInParent =
          findInternalUserIdInReactValue(fiber.memoizedProps, userId) ||
          findInternalUserIdInReactValue(fiber.pendingProps, userId)

        if (foundInParent) {
          return foundInParent
        }

        fiber = fiber.return
      }
    }
  }

  return null
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
  const userInternalId =
    getUserInternalIdFromReactData(avatarEl, userId) ||
    getUserInternalIdFromReactData(quoteDivElement, userId)

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
    userInternalId,
    text,
    hasImages,
    hasVideos,
    hasMedia: hasImages || hasVideos
  }
}

/**
 * リポスト文脈の有無と、リポストしたユーザー ID を抽出する。
 * 入力: 親 article 要素
 * 出力: isRepost と repostedBy を持つオブジェクト
 * 主な処理内容: socialContext の親リンクから /<screen_name> 形式のプロフィールパスだけを採用する
 */
function extractRepostInfo (article) {
  const socialContextEl = article.querySelector('[data-testid="socialContext"]')
  if (!socialContextEl) {
    return {
      isRepost: false,
      repostedBy: null
    }
  }

  const repostLink = socialContextEl.closest('a[href^="/"]')
  if (!repostLink) {
    return {
      isRepost: true,
      repostedBy: null
    }
  }

  const href = repostLink.getAttribute('href') || ''
  // socialContext 近傍には投稿詳細リンクもあり得るため、プロフィール直下のパスだけを採用する。
  const match = href.match(/^\/([^/?#]+)$/)

  return {
    isRepost: true,
    repostedBy: match ? match[1] : null
  }
}

/**
 * タイムライン上の article から投稿情報を抽出する。
 * 入力: article 要素
 * 出力: statusId / userId / 本文 / リポスト情報 / メディア有無 / 引用情報を含むオブジェクト
 * 主な処理内容:
 * 1. 投稿 ID とユーザー ID を取る
 * 2. 本文を見た目に近い形で復元する
 * 3. socialContext からリポスト情報を取る
 * 4. 引用投稿内メディアを差し引いたうえで自前メディアを判定する
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
  const userInternalId =
    getUserInternalIdFromReactData(avatarEl, userId) ||
    getUserInternalIdFromReactData(article, userId)

  const tweetTextEl = article.querySelector('[data-testid="tweetText"]')
  const text = tweetTextEl ? getFullVisibleText(tweetTextEl).trim() : ''
  const { isRepost, repostedBy } = extractRepostInfo(article)

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
    userInternalId,
    text,
    isRepost,
    repostedBy,
    hasImages,
    hasVideos,
    hasMedia: hasImages || hasVideos,
    quote
  }
}
