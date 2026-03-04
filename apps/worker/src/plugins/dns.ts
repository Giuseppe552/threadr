import dns from 'node:dns/promises'
import type { Plugin, PluginResult } from '@threadr/shared'

export const dnsPlugin: Plugin = {
  id: 'dns',
  name: 'DNS Records',
  accepts: ['Domain'],
  requiresKey: false,
  rateLimit: { requests: 30, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const found: PluginResult['nodes'] = []
    const rels: PluginResult['edges'] = []
    const domain = seed.value

    try {
      const mx = await dns.resolveMx(domain)
      for (const m of mx) {
        console.log(`[+] MX: ${m.exchange}`)
        found.push({ label: 'Domain', key: 'name', props: { name: m.exchange } })
        rels.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: m.exchange, rel: 'HAS_MX',
        })
      }
    } catch { /* no mx */ }

    try {
      const txt = await dns.resolveTxt(domain)
      for (const t of txt) {
        const val = t.join('')
        if (val.includes('v=spf') || val.includes('google') || val.includes('microsoft')) {
          console.log(`[+] TXT: ${val.slice(0, 80)}`)
        }
      }
    } catch { /* no txt */ }

    return { nodes: found, edges: rels }
  },
}
