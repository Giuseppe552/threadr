/**
 * Anonymous proxy layer — routes all plugin traffic through SOCKS5/Tor.
 *
 * Architecture:
 * - Each plugin gets its own SOCKS5 proxy (different Tor circuit = different exit IP)
 * - DNS resolves through the proxy (socks5h), never through the system resolver
 * - Raw TCP (WHOIS, SMTP) tunnels through SOCKS5 via the `socks` package
 * - Poisson-distributed timing jitter between requests (anti-traffic-analysis)
 * - Cipher suite shuffling to avoid JA3 TLS fingerprinting
 * - Optional chaff requests mixed with real traffic
 *
 * When proxy is disabled (default), all functions pass through transparently.
 */

import { socksDispatcher } from 'fetch-socks'
import { SocksClient } from 'socks'
import type { Dispatcher } from 'undici'
import tls from 'node:tls'

export interface ProxyConfig {
  enabled: boolean
  // List of SOCKS5 proxies to rotate through (e.g., multiple Tor instances)
  proxies: { host: string; port: number }[]
  // Timing jitter: mean delay between requests in ms (Poisson λ)
  jitterMeanMs: number
  // Generate chaff (dummy) requests
  chaffEnabled: boolean
  // Chaff ratio: 1 = one chaff per real request, 0.5 = one chaff per two real
  chaffRatio: number
  // Shuffle TLS cipher suites
  shuffleCiphers: boolean
}

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  proxies: [{ host: '127.0.0.1', port: 9150 }],
  jitterMeanMs: 2000,
  chaffEnabled: false,
  chaffRatio: 0.3,
  shuffleCiphers: true,
}

let config: ProxyConfig = { ...DEFAULT_CONFIG }
let proxyIndex = 0

export function configureProxy(opts: Partial<ProxyConfig>) {
  config = { ...DEFAULT_CONFIG, ...opts }
  if (config.shuffleCiphers) shuffleTlsCiphers()
}

export function isProxyEnabled(): boolean {
  return config.enabled
}

// --- Proxy selection ---

function nextProxy(): { host: string; port: number } {
  const proxy = config.proxies[proxyIndex % config.proxies.length]
  proxyIndex++
  return proxy
}

/**
 * Get a proxy assigned to a specific plugin ID.
 * Same plugin always gets the same proxy (deterministic mapping).
 * Different plugins get different proxies when enough are available.
 */
export function proxyForPlugin(pluginId: string): { host: string; port: number } {
  // Simple hash of plugin ID to proxy index
  let hash = 0
  for (let i = 0; i < pluginId.length; i++) {
    hash = ((hash << 5) - hash + pluginId.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % config.proxies.length
  return config.proxies[idx]
}

// --- Proxied fetch ---

/**
 * Create an undici Dispatcher for a specific SOCKS5 proxy.
 * Use with: fetch(url, { dispatcher })
 */
export function createDispatcher(proxy: { host: string; port: number }): Dispatcher {
  return socksDispatcher({
    type: 5,
    host: proxy.host,
    port: proxy.port,
  })
}

/**
 * Fetch through the proxy layer. Drop-in replacement for global fetch().
 * When proxy is disabled, calls fetch() directly.
 */
export async function proxiedFetch(
  url: string | URL,
  pluginId: string,
  init?: RequestInit,
): Promise<Response> {
  // Timing jitter
  if (config.enabled && config.jitterMeanMs > 0) {
    await poissonDelay(config.jitterMeanMs)
  }

  // Chaff request (before real request, randomly)
  if (config.enabled && config.chaffEnabled && Math.random() < config.chaffRatio) {
    await sendChaff(pluginId)
  }

  if (!config.enabled) {
    return fetch(url, init)
  }

  const proxy = proxyForPlugin(pluginId)
  const dispatcher = createDispatcher(proxy)

  // Strip threadr User-Agent when proxied — use a generic browser UA
  const headers = new Headers(init?.headers)
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', randomUserAgent())
  }

  return fetch(url, {
    ...init,
    headers,
    // @ts-expect-error — dispatcher is valid for undici-backed fetch
    dispatcher,
  })
}

// --- Proxied raw TCP (WHOIS, SMTP) ---

/**
 * Create a raw TCP socket through a SOCKS5 proxy.
 * Returns a net.Socket connected to the destination.
 */
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

// --- DNS over HTTPS (avoids system resolver leak) ---

interface DohRecord {
  name: string
  type: number
  data: string
  TTL: number
}

/**
 * Resolve DNS via Cloudflare DoH (1.1.1.1).
 * When proxy is enabled, the DoH request itself goes through the proxy.
 * This prevents DNS leaks through the system resolver.
 */
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
    .map(r => r.data.replace(/\.$/, '')) // strip trailing dot
}

function dnsTypeCode(type: string): number {
  const codes: Record<string, number> = {
    A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, SOA: 6, PTR: 12,
  }
  return codes[type.toUpperCase()] ?? 1
}

// --- Poisson timing jitter ---

/**
 * Wait for a random duration drawn from an exponential distribution.
 *
 * The Poisson process has inter-arrival times that are exponentially
 * distributed: P(T > t) = e^{-λt}
 *
 * This makes request timing look like natural human browsing rather
 * than machine-generated bursts. An observer seeing requests from
 * a Tor exit node cannot correlate them by timing pattern.
 *
 * @param meanMs - Mean delay in milliseconds (λ = 1/meanMs)
 */
export function poissonDelay(meanMs: number): Promise<void> {
  // Inverse transform sampling: T = -mean * ln(U) where U ~ Uniform(0,1)
  const u = Math.random()
  const delay = Math.round(-meanMs * Math.log(u || 0.001)) // avoid log(0)
  // Cap at 10x mean to prevent extreme outliers
  const capped = Math.min(delay, meanMs * 10)
  return new Promise(resolve => setTimeout(resolve, capped))
}

// --- Chaff/decoy requests ---

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

/**
 * Send a decoy request to a random benign URL.
 * An observer at the Tor exit node sees a mix of real OSINT queries
 * and normal web traffic — can't distinguish which is which.
 */
async function sendChaff(pluginId: string): Promise<void> {
  const target = CHAFF_TARGETS[Math.floor(Math.random() * CHAFF_TARGETS.length)]
  try {
    const res = await proxiedFetch(target, pluginId, {
      method: 'HEAD',
      headers: { 'User-Agent': randomUserAgent() },
    })
    // Consume and discard
    await res.arrayBuffer().catch(() => {})
  } catch {
    // Chaff failure is irrelevant
  }
}

// --- User-Agent rotation ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
]

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// --- TLS cipher shuffling ---

/**
 * Shuffle the TLS cipher suite order to avoid JA3 fingerprinting.
 * Node.js has a distinctive default cipher order that identifies it.
 * Shuffling makes each connection look like a different client.
 *
 * Keeps the first 3 ciphers (most important for security) in place,
 * shuffles the rest. One-time operation at startup.
 */
function shuffleTlsCiphers() {
  const ciphers = tls.DEFAULT_CIPHERS.split(':')
  if (ciphers.length <= 3) return

  // Keep first 3, shuffle rest (Fisher-Yates)
  const head = ciphers.slice(0, 3)
  const tail = ciphers.slice(3)
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]]
  }

  tls.DEFAULT_CIPHERS = [...head, ...tail].join(':')
}
