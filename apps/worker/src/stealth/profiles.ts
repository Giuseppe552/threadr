/**
 * Browser identity profiles for request mimicry.
 *
 * Each profile defines the EXACT header order, values, and client hints
 * that a specific browser version sends. When stealth mode is active,
 * every HTTP request is rebuilt to match the selected profile.
 *
 * The header ORDER is critical — anti-bot systems (Akamai, Cloudflare,
 * DataDome) compare against known browser signatures. Sending the right
 * headers in the wrong order reveals the client isn't a real browser.
 *
 * Reference: https://docs.hypersolutions.co/request-based-basics/header-order
 */

export interface BrowserProfile {
  id: string
  name: string
  userAgent: string
  secChUa: string
  secChUaMobile: string
  secChUaPlatform: string
  acceptLanguage: string
  acceptEncoding: string
  accept: string
  // Header names in the exact order the browser sends them
  headerOrder: string[]
}

/**
 * Chrome 131 on Windows 10 — the most common browser/OS combination.
 * Headers captured from a real Chrome 131 installation via Wireshark.
 */
const CHROME_131_WIN: BrowserProfile = {
  id: 'chrome-131-win',
  name: 'Chrome 131 / Windows 10',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"',
  secChUaMobile: '?0',
  secChUaPlatform: '"Windows"',
  acceptLanguage: 'en-US,en;q=0.9',
  acceptEncoding: 'gzip, deflate, br, zstd',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  headerOrder: [
    'host',
    'connection',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'upgrade-insecure-requests',
    'user-agent',
    'accept',
    'sec-fetch-site',
    'sec-fetch-mode',
    'sec-fetch-user',
    'sec-fetch-dest',
    'accept-encoding',
    'accept-language',
    'cookie',
  ],
}

const CHROME_131_MAC: BrowserProfile = {
  id: 'chrome-131-mac',
  name: 'Chrome 131 / macOS',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"',
  secChUaMobile: '?0',
  secChUaPlatform: '"macOS"',
  acceptLanguage: 'en-US,en;q=0.9',
  acceptEncoding: 'gzip, deflate, br, zstd',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  headerOrder: [
    'host',
    'connection',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'upgrade-insecure-requests',
    'user-agent',
    'accept',
    'sec-fetch-site',
    'sec-fetch-mode',
    'sec-fetch-user',
    'sec-fetch-dest',
    'accept-encoding',
    'accept-language',
    'cookie',
  ],
}

const FIREFOX_134_WIN: BrowserProfile = {
  id: 'firefox-134-win',
  name: 'Firefox 134 / Windows 10',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  secChUa: '',  // Firefox doesn't send sec-ch-ua
  secChUaMobile: '',
  secChUaPlatform: '',
  acceptLanguage: 'en-US,en;q=0.5',
  acceptEncoding: 'gzip, deflate, br',  // no zstd in Firefox
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  // Firefox header order is different from Chrome
  headerOrder: [
    'host',
    'user-agent',
    'accept',
    'accept-language',
    'accept-encoding',
    'connection',
    'upgrade-insecure-requests',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-fetch-user',
    'cookie',
  ],
}

const CHROME_131_LINUX: BrowserProfile = {
  id: 'chrome-131-linux',
  name: 'Chrome 131 / Linux',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"',
  secChUaMobile: '?0',
  secChUaPlatform: '"Linux"',
  acceptLanguage: 'en-US,en;q=0.9',
  acceptEncoding: 'gzip, deflate, br, zstd',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  headerOrder: [
    'host',
    'connection',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'upgrade-insecure-requests',
    'user-agent',
    'accept',
    'sec-fetch-site',
    'sec-fetch-mode',
    'sec-fetch-user',
    'sec-fetch-dest',
    'accept-encoding',
    'accept-language',
    'cookie',
  ],
}

export const PROFILES: Record<string, BrowserProfile> = {
  'chrome-131-win': CHROME_131_WIN,
  'chrome-131-mac': CHROME_131_MAC,
  'chrome-131-linux': CHROME_131_LINUX,
  'firefox-134-win': FIREFOX_134_WIN,
}

export const DEFAULT_PROFILE = 'chrome-131-win'

/**
 * Select a random profile, weighted towards Chrome (80% market share).
 */
export function randomProfile(): BrowserProfile {
  const r = Math.random()
  if (r < 0.4) return CHROME_131_WIN
  if (r < 0.6) return CHROME_131_MAC
  if (r < 0.8) return CHROME_131_LINUX
  return FIREFOX_134_WIN
}

/**
 * Build a complete set of headers for a request, in the browser's exact order.
 *
 * @param profile - Browser profile to mimic
 * @param url - Target URL (for Host and Sec-Fetch-Site)
 * @param extraHeaders - Additional headers from the plugin (merged in)
 * @param referrer - Referrer URL (from session continuity)
 * @param cookies - Cookie header value (from cookie jar)
 */
export function buildHeaders(
  profile: BrowserProfile,
  url: string,
  extraHeaders?: Record<string, string>,
  referrer?: string,
  cookies?: string,
): [string, string][] {
  const parsed = new URL(url)
  const isApi = parsed.pathname.includes('/api/') || parsed.pathname.includes('/v1/') || parsed.pathname.includes('/v2/') || parsed.pathname.includes('/v3/')

  // Build the unordered header map
  const map: Record<string, string> = {
    'host': parsed.host,
    'connection': 'keep-alive',
    'user-agent': profile.userAgent,
    'accept-encoding': profile.acceptEncoding,
    'accept-language': profile.acceptLanguage,
  }

  // Accept depends on request type
  if (isApi) {
    map['accept'] = 'application/json, text/plain, */*'
  } else {
    map['accept'] = profile.accept
  }

  // Chrome-specific client hints
  if (profile.secChUa) {
    map['sec-ch-ua'] = profile.secChUa
    map['sec-ch-ua-mobile'] = profile.secChUaMobile
    map['sec-ch-ua-platform'] = profile.secChUaPlatform
  }

  // Sec-Fetch headers
  if (!isApi) {
    map['upgrade-insecure-requests'] = '1'
    map['sec-fetch-site'] = referrer ? 'same-origin' : 'none'
    map['sec-fetch-mode'] = 'navigate'
    map['sec-fetch-user'] = '?1'
    map['sec-fetch-dest'] = 'document'
  } else {
    map['sec-fetch-site'] = 'same-origin'
    map['sec-fetch-mode'] = 'cors'
    map['sec-fetch-dest'] = 'empty'
  }

  // Referrer
  if (referrer) {
    map['referer'] = referrer
  }

  // Cookies
  if (cookies) {
    map['cookie'] = cookies
  }

  // Merge plugin-specific headers (API keys, etc.)
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      const lower = k.toLowerCase()
      // Don't let plugins override identity headers
      if (lower === 'user-agent' || lower === 'accept-encoding') continue
      map[lower] = v
    }
  }

  // Order headers according to the profile
  const ordered: [string, string][] = []
  for (const name of profile.headerOrder) {
    if (map[name] !== undefined) {
      ordered.push([name, map[name]])
      delete map[name]
    }
  }
  // Append any remaining headers not in the profile order
  for (const [k, v] of Object.entries(map)) {
    ordered.push([k, v])
  }

  return ordered
}

/**
 * Convert ordered header pairs to a Headers object.
 * Note: the Headers constructor doesn't guarantee order, but
 * undici preserves insertion order in practice.
 */
export function toHeaders(pairs: [string, string][]): Headers {
  const h = new Headers()
  for (const [k, v] of pairs) {
    h.append(k, v)
  }
  return h
}
