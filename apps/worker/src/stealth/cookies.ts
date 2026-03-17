/**
 * In-memory cookie jar for session continuity.
 *
 * When stealth mode is active, cookies from Set-Cookie response headers
 * are stored and sent back on subsequent requests to the same domain.
 * This mimics real browser behaviour — stateless requests are the #1
 * signal that a client is a bot.
 *
 * Cookies are scoped per-domain and cleared at scan end. No persistence
 * between scans (privacy).
 */

interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires?: number // unix timestamp
}

const jars = new Map<string, Cookie[]>()

/**
 * Parse Set-Cookie headers from a response and store them.
 */
export function captureResponseCookies(domain: string, response: Response) {
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const raw of setCookies) {
    const cookie = parseSetCookie(raw, domain)
    if (cookie) storeCookie(cookie)
  }
}

/**
 * Get the Cookie header value for a request to a domain.
 * Returns undefined if no cookies are stored for this domain.
 */
export function getCookieHeader(domain: string, path: string = '/', secure: boolean = true): string | undefined {
  const now = Date.now()
  const cookies: Cookie[] = []

  // Check exact domain and parent domains
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.')
    const jar = jars.get(d)
    if (!jar) continue

    for (const c of jar) {
      // Check expiry
      if (c.expires && c.expires < now) continue
      // Check path
      if (!path.startsWith(c.path)) continue
      // Check secure
      if (c.secure && !secure) continue
      cookies.push(c)
    }
  }

  if (cookies.length === 0) return undefined

  // Deduplicate by name (later cookies override earlier)
  const seen = new Map<string, string>()
  for (const c of cookies) seen.set(c.name, c.value)

  return [...seen.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Clear all cookies. Called at scan end.
 */
export function clearCookies() {
  jars.clear()
}

function storeCookie(cookie: Cookie) {
  const domain = cookie.domain.replace(/^\./, '') // strip leading dot
  if (!jars.has(domain)) jars.set(domain, [])
  const jar = jars.get(domain)!

  // Replace existing cookie with same name
  const idx = jar.findIndex(c => c.name === cookie.name)
  if (idx >= 0) jar[idx] = cookie
  else jar.push(cookie)
}

function parseSetCookie(raw: string, requestDomain: string): Cookie | null {
  const parts = raw.split(';').map(s => s.trim())
  if (parts.length === 0) return null

  const [nameVal, ...attrs] = parts
  const eqIdx = nameVal.indexOf('=')
  if (eqIdx < 0) return null

  const name = nameVal.slice(0, eqIdx).trim()
  const value = nameVal.slice(eqIdx + 1).trim()

  if (!name) return null

  const cookie: Cookie = {
    name,
    value,
    domain: requestDomain,
    path: '/',
    secure: false,
    httpOnly: false,
  }

  for (const attr of attrs) {
    const [aName, aVal] = attr.split('=').map(s => s.trim())
    const lower = aName.toLowerCase()

    switch (lower) {
      case 'domain':
        if (aVal) cookie.domain = aVal.replace(/^\./, '')
        break
      case 'path':
        if (aVal) cookie.path = aVal
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'max-age': {
        const seconds = parseInt(aVal, 10)
        if (!isNaN(seconds)) cookie.expires = Date.now() + seconds * 1000
        break
      }
      case 'expires': {
        const ts = Date.parse(aVal)
        if (!isNaN(ts)) cookie.expires = ts
        break
      }
    }
  }

  return cookie
}
