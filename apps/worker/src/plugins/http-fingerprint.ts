import type { Plugin, PluginResult } from '@threadr/shared'

/**
 * HTTP fingerprinting — detects web server, framework, CDN, and
 * technology stack from response headers and HTML content.
 */

const TECH_SIGNATURES: { name: string; match: (headers: Record<string, string>, body: string) => boolean }[] = [
  { name: 'nginx', match: (h) => h.server?.toLowerCase().includes('nginx') ?? false },
  { name: 'apache', match: (h) => h.server?.toLowerCase().includes('apache') ?? false },
  { name: 'cloudflare', match: (h) => !!h['cf-ray'] || h.server === 'cloudflare' },
  { name: 'aws', match: (h) => !!h['x-amz-request-id'] || h.server?.includes('AmazonS3') || !!h['x-amz-cf-id'] },
  { name: 'vercel', match: (h) => !!h['x-vercel-id'] || h.server === 'Vercel' },
  { name: 'netlify', match: (h) => !!h['x-nf-request-id'] || h.server?.includes('Netlify') },
  { name: 'wordpress', match: (_, b) => b.includes('wp-content') || b.includes('wp-includes') },
  { name: 'react', match: (_, b) => b.includes('__NEXT_DATA__') || b.includes('_next/static') || b.includes('id="root"') },
  { name: 'vue', match: (_, b) => b.includes('id="app"') && b.includes('vue') },
  { name: 'shopify', match: (_, b) => b.includes('cdn.shopify.com') },
  { name: 'squarespace', match: (_, b) => b.includes('squarespace.com') },
  { name: 'wix', match: (_, b) => b.includes('static.wixstatic.com') },
  { name: 'php', match: (h) => !!h['x-powered-by']?.toLowerCase().includes('php') },
  { name: 'asp.net', match: (h) => !!h['x-powered-by']?.toLowerCase().includes('asp.net') || !!h['x-aspnet-version'] },
  { name: 'express', match: (h) => h['x-powered-by'] === 'Express' },
  { name: 'django', match: (h) => !!h['x-frame-options'] && !!h['x-content-type-options'] && h.server === '' },
  { name: 'laravel', match: (h) => h['set-cookie']?.includes('laravel_session') ?? false },
  { name: 'rails', match: (h) => h['x-powered-by']?.includes('Phusion Passenger') || h['x-runtime'] !== undefined },
  { name: 'cloudfront', match: (h) => !!h['x-amz-cf-id'] || h['via']?.includes('cloudfront') },
  { name: 'fastly', match: (h) => !!h['x-served-by'] && h['via']?.includes('varnish') },
  { name: 'akamai', match: (h) => !!h['x-akamai-transformed'] },
  { name: 'hsts', match: (h) => !!h['strict-transport-security'] },
]

export const httpFingerprint: Plugin = {
  id: 'http-fingerprint',
  name: 'HTTP Fingerprint',
  accepts: ['Domain'],
  requiresKey: false,
  rateLimit: { requests: 15, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const domain = seed.value

    // Skip non-web domains (nameservers, mail servers)
    if (domain.startsWith('ns') && domain.split('.').length > 2) return { nodes, edges }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch(`https://${domain}`, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; threadr/0.1)' },
      })
      clearTimeout(timeout)

      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })

      // Only read first 50KB of body for fingerprinting
      const reader = res.body?.getReader()
      let body = ''
      if (reader) {
        let bytes = 0
        const decoder = new TextDecoder()
        while (bytes < 50_000) {
          const { done, value } = await reader.read()
          if (done) break
          body += decoder.decode(value, { stream: true })
          bytes += value?.length ?? 0
        }
        reader.cancel().catch(() => {})
      }

      // Detect technologies
      const detected: string[] = []
      for (const sig of TECH_SIGNATURES) {
        try {
          if (sig.match(headers, body)) detected.push(sig.name)
        } catch { /* skip broken matcher */ }
      }

      if (detected.length > 0) {
        console.log(`[+] http: ${domain} → ${detected.join(', ')}`)
      }

      // Extract title
      const titleMatch = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i)
      const title = titleMatch?.[1]?.trim() || ''

      // Store as properties on domain node
      const props: Record<string, string> = { name: domain }
      if (headers.server) props.http_server = headers.server
      if (detected.length > 0) props.http_tech = detected.join(',')
      if (title) props.http_title = title
      if (headers['x-powered-by']) props.http_powered_by = headers['x-powered-by']
      props.http_status = String(res.status)

      // Security headers
      if (headers['strict-transport-security']) props.hsts = 'yes'
      if (headers['content-security-policy']) props.csp = 'yes'
      if (headers['x-frame-options']) props.x_frame_options = headers['x-frame-options']

      nodes.push({ label: 'Domain', key: 'name', props })
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.includes('abort')) {
        console.log(`[-] http: ${domain} — ${msg.slice(0, 60)}`)
      }
    }

    return { nodes, edges }
  },
}
