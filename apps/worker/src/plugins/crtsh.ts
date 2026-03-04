import dns from 'node:dns/promises'
import type { Plugin, PluginResult } from '@threadr/shared'

export const crtsh: Plugin = {
  id: 'crtsh',
  name: 'Certificate Transparency',
  accepts: ['Domain'],
  requiresKey: false,
  rateLimit: { requests: 5, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const domain = seed.value

    console.log(`[*] crt.sh: ${domain}`)
    const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`) // crt.sh is slow sometimes
    if (!res.ok) {
      console.log(`[!] crt.sh: ${res.status}`)
      return { nodes, edges }
    }

    const certs = await res.json()
    const names = new Set<string>()
    for (const c of certs) {
      const val = c.name_value as string
      val.split('\n').forEach((n: string) => names.add(n.toLowerCase()))
    }

    const subs = [...names].filter(n => n !== domain && !n.startsWith('*'))
    console.log(`[+] ${subs.length} subdomains`)

    for (const s of subs.slice(0, 20)) {
      nodes.push({ label: 'Domain', key: 'name', props: { name: s } })
      edges.push({
        fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
        toLabel: 'Domain', toKey: 'name', toVal: s, rel: 'HAS_CERT',
      })

      // resolve to IPs
      try {
        const addrs = await dns.resolve4(s)
        for (const ip of addrs) {
          nodes.push({ label: 'IP', key: 'address', props: { address: ip } })
          edges.push({
            fromLabel: 'Domain', fromKey: 'name', fromVal: s,
            toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
          })
        }
      } catch { /* nxdomain */ }
    }

    return { nodes, edges }
  },
}
