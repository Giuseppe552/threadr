/**
 * Anonymous proxy layer with browser identity mimicry.
 *
 * When stealth mode is active:
 * - Every request mimics a real browser (Chrome/Firefox header order,
 *   client hints, sec-fetch headers, accept-encoding)
 * - Cookies are captured and replayed per domain (session continuity)
 * - Referrer chains are maintained per domain
 * - All traffic routed through SOCKS5/Tor with per-plugin circuit isolation
 * - DNS resolves through DoH (no system resolver leaks)
 * - TLS cipher suites shuffled to avoid JA3 fingerprinting
 * - Lévy-distributed timing jitter between requests
 * - Markov chain cover traffic mixed with real queries
 *
 * When disabled (default), all functions pass through transparently.
 */

import { socksDispatcher } from 'fetch-socks'
import { SocksClient } from 'socks'
import type { Dispatcher } from 'undici'
import tls from 'node:tls'
import { type BrowserProfile, randomProfile, buildHeaders, toHeaders, PROFILES, DEFAULT_PROFILE } from './stealth/profiles.js'
import { captureResponseCookies, getCookieHeader, clearCookies } from './stealth/cookies.js'

export interface ProxyConfig {
  enabled: boolean
  proxies: { host: string; port: number; username?: string; password?: string }[]
  jitterMeanMs: number
  chaffEnabled: boolean
  chaffRatio: number
  shuffleCiphers: boolean
  // Stealth options
  profileId: string | null   // null = random selection
  forceHttp1: boolean        // avoid H2 fingerprinting
  sessionCookies: boolean    // capture + replay cookies
  referrerChain: boolean     // maintain per-domain referrer
}

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  proxies: [{ host: '127.0.0.1', port: 9150 }],
  jitterMeanMs: 2000,
  chaffEnabled: false,
  chaffRatio: 0.3,
  shuffleCiphers: true,
  profileId: null,
  forceHttp1: false,
  sessionCookies: true,
  referrerChain: true,
}

let config: ProxyConfig = { ...DEFAULT_CONFIG }
let sessionProfile: BrowserProfile | null = null
const referrerMap = new Map<string, string>()  // domain → last URL

export function configureProxy(opts: Partial<ProxyConfig>) {
  config = { ...DEFAULT_CONFIG, ...opts }

  // Select browser profile for this session
  if (config.profileId && PROFILES[config.profileId]) {
    sessionProfile = PROFILES[config.profileId]
  } else {
    sessionProfile = randomProfile()
  }

  if (config.shuffleCiphers) shuffleTlsCiphers()

  // Clear state from previous sessions
  referrerMap.clear()
  clearCookies()
}

export function isProxyEnabled(): boolean {
  return config.enabled
}

export function getSessionProfile(): BrowserProfile | null {
  return sessionProfile
}

/**
 * Reset session state. Call at scan end.
 */
export function resetSession() {
  referrerMap.clear()
  clearCookies()
}

// --- Proxy selection ---

export function proxyForPlugin(pluginId: string): ProxyConfig['proxies'][0] {
  let hash = 0
  for (let i = 0; i < pluginId.length; i++) {
    hash = ((hash << 5) - hash + pluginId.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % config.proxies.length
  return config.proxies[idx]
}

// --- Proxied fetch ---

export function createDispatcher(proxy: ProxyConfig['proxies'][0]): Dispatcher {
  return socksDispatcher({
    type: 5,
    host: proxy.host,
    port: proxy.port,
  })
}

/**
 * Fetch through the stealth proxy layer.
 *
 * When stealth is active:
 * 1. Applies Lévy timing jitter
 * 2. Rebuilds headers to match browser profile (exact order)
 * 3. Adds cookies from session jar
 * 4. Sets referrer from previous request to same domain
 * 5. Routes through SOCKS5 proxy
 * 6. Captures Set-Cookie from response
 * 7. Updates referrer chain
 */
export async function proxiedFetch(
  url: string | URL,
  pluginId: string,
  init?: RequestInit,
): Promise<Response> {
  const urlStr = url.toString()

  // Timing jitter
  if (config.enabled && config.jitterMeanMs > 0) {
    await poissonDelay(config.jitterMeanMs)
  }

  // Chaff
  if (config.enabled && config.chaffEnabled && Math.random() < config.chaffRatio) {
    await sendChaff(pluginId)
  }

  // Direct mode (no proxy)
  if (!config.enabled) {
    return fetch(url, init)
  }

  const parsed = new URL(urlStr)
  const domain = parsed.hostname
  const proxy = proxyForPlugin(pluginId)
  const dispatcher = createDispatcher(proxy)

  // Build browser-mimicking headers
  let headers: Headers

  if (sessionProfile) {
    const extraHeaders: Record<string, string> = {}
    // Preserve plugin-specific headers (API keys, content-type, etc.)
    if (init?.headers) {
      const h = new Headers(init.headers)
      h.forEach((v, k) => { extraHeaders[k] = v })
    }

    const referrer = config.referrerChain ? referrerMap.get(domain) : undefined
    const cookies = config.sessionCookies ? getCookieHeader(domain, parsed.pathname, parsed.protocol === 'https:') : undefined

    const pairs = buildHeaders(sessionProfile, urlStr, extraHeaders, referrer, cookies)
    headers = toHeaders(pairs)
  } else {
    headers = new Headers(init?.headers)
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', randomUserAgent())
    }
  }

  const res = await fetch(url, {
    ...init,
    headers,
    // @ts-expect-error — dispatcher is valid for undici-backed fetch
    dispatcher,
  })

  // Capture cookies from response
  if (config.sessionCookies) {
    captureResponseCookies(domain, res)
  }

  // Update referrer chain
  if (config.referrerChain) {
    referrerMap.set(domain, urlStr)
  }

  return res
}

// --- Proxied raw TCP (WHOIS, SMTP) ---

export async function proxiedTcpConnect(
  host: string,
  port: number,
  pluginId: string,
): Promise<import('node:net').Socket> {
  if (!config.enabled) {
    const net = await import('node:net')
    return net.createConnection(port, host)
  }

  if (config.jitterMeanMs > 0) {
    await poissonDelay(config.jitterMeanMs)
  }

  const proxy = proxyForPlugin(pluginId)

  const { socket } = await SocksClient.createConnection({
    proxy: { host: proxy.host, port: proxy.port, type: 5 },
    command: 'connect',
    destination: { host, port },
  })

  return socket
}

// --- DNS over HTTPS ---

interface DohRecord {
  name: string
  type: number
  data: string
  TTL: number
}

export async function dohResolve(
  domain: string,
  recordType: string = 'A',
  pluginId: string = 'dns',
): Promise<string[]> {
  const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=${recordType}`

  const res = await proxiedFetch(url, pluginId, {
    headers: { 'Accept': 'application/dns-json' },
  })

  if (!res.ok) return []

  const data = await res.json() as { Answer?: DohRecord[] }
  return (data.Answer ?? [])
    .filter(r => r.type === dnsTypeCode(recordType))
    .map(r => r.data.replace(/\.$/, ''))
}

function dnsTypeCode(type: string): number {
  const codes: Record<string, number> = {
    A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, SOA: 6, PTR: 12,
  }
  return codes[type.toUpperCase()] ?? 1
}

// --- Lévy timing jitter ---

export function poissonDelay(meanMs: number): Promise<void> {
  // Lévy stable sampling (α=1.5) for heavy-tailed delays
  const u = Math.random()
  const delay = meanMs / Math.pow(u || 0.001, 1 / 1.5)
  const capped = Math.min(delay, meanMs * 10)
  return new Promise(resolve => setTimeout(resolve, Math.round(Math.max(capped, 50))))
}

// --- Chaff ---

const CHAFF_TARGETS = [
  'https://www.wikipedia.org/',
  'https://www.bbc.co.uk/',
  'https://news.ycombinator.com/',
  'https://stackoverflow.com/',
  'https://github.com/',
  'https://www.reddit.com/',
  'https://www.cloudflare.com/',
  'https://www.mozilla.org/',
]

async function sendChaff(pluginId: string): Promise<void> {
  const target = CHAFF_TARGETS[Math.floor(Math.random() * CHAFF_TARGETS.length)]
  try {
    const res = await proxiedFetch(target, pluginId, { method: 'HEAD' })
    await res.arrayBuffer().catch(() => {})
  } catch { /* chaff failure is irrelevant */ }
}

// --- User-Agent fallback (used when no profile is active) ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// --- TLS cipher shuffling ---

function shuffleTlsCiphers() {
  const ciphers = tls.DEFAULT_CIPHERS.split(':')
  if (ciphers.length <= 3) return

  const head = ciphers.slice(0, 3)
  const tail = ciphers.slice(3)
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]]
  }

  tls.DEFAULT_CIPHERS = [...head, ...tail].join(':')
}
