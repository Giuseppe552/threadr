/**
 * Network primitives for plugins. All network calls go through here.
 * When proxy is enabled, traffic is routed through SOCKS5/Tor.
 * When disabled, everything passes through transparently.
 */

import { proxiedFetch, proxiedTcpConnect, dohResolve, isProxyEnabled } from './proxy.js'
import dns from 'node:dns/promises'
import net from 'node:net'

/**
 * Plugin-aware fetch. Routes through proxy when enabled.
 */
export function pluginFetch(
  url: string | URL,
  pluginId: string,
  init?: RequestInit,
): Promise<Response> {
  return proxiedFetch(url, pluginId, init)
}

/**
 * DNS resolution. Uses DoH through the proxy when enabled,
 * system resolver when disabled.
 */
export async function pluginResolve4(domain: string, pluginId: string): Promise<string[]> {
  if (isProxyEnabled()) return dohResolve(domain, 'A', pluginId)
  try { return await dns.resolve4(domain) } catch { return [] }
}

export async function pluginResolve6(domain: string, pluginId: string): Promise<string[]> {
  if (isProxyEnabled()) return dohResolve(domain, 'AAAA', pluginId)
  try { return await dns.resolve6(domain) } catch { return [] }
}

export async function pluginResolveMx(domain: string, pluginId: string): Promise<{ exchange: string; priority: number }[]> {
  if (isProxyEnabled()) {
    const records = await dohResolve(domain, 'MX', pluginId)
    // DoH MX format: "10 mail.example.com"
    return records.map(r => {
      const parts = r.split(' ')
      return { priority: parseInt(parts[0], 10) || 0, exchange: parts.slice(1).join(' ') }
    })
  }
  try { return await dns.resolveMx(domain) } catch { return [] }
}

export async function pluginResolveNs(domain: string, pluginId: string): Promise<string[]> {
  if (isProxyEnabled()) return dohResolve(domain, 'NS', pluginId)
  try { return await dns.resolveNs(domain) } catch { return [] }
}

export async function pluginResolveTxt(domain: string, pluginId: string): Promise<string[][]> {
  if (isProxyEnabled()) {
    const records = await dohResolve(domain, 'TXT', pluginId)
    // DoH returns TXT as strings (already joined)
    return records.map(r => [r.replace(/^"|"$/g, '')])
  }
  try { return await dns.resolveTxt(domain) } catch { return [] }
}

export async function pluginResolveCname(domain: string, pluginId: string): Promise<string[]> {
  if (isProxyEnabled()) return dohResolve(domain, 'CNAME', pluginId)
  try { return await dns.resolveCname(domain) } catch { return [] }
}

export async function pluginReverse(ip: string, pluginId: string): Promise<string[]> {
  if (isProxyEnabled()) return dohResolve(ip.split('.').reverse().join('.') + '.in-addr.arpa', 'PTR', pluginId)
  try { return await dns.reverse(ip) } catch { return [] }
}

/**
 * Raw TCP connection. Routes through SOCKS5 when proxy is enabled.
 */
export function pluginTcpConnect(
  host: string,
  port: number,
  pluginId: string,
): Promise<net.Socket> {
  if (isProxyEnabled()) return proxiedTcpConnect(host, port, pluginId)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host)
    socket.on('connect', () => resolve(socket))
    socket.on('error', reject)
  })
}
