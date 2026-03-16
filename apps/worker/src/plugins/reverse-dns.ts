import dns from 'node:dns/promises'
import type { Plugin, PluginResult } from '@threadr/shared'

export const reverseDns: Plugin = {
  id: 'reverse-dns',
  name: 'Reverse DNS',
  accepts: ['IP'],
  requiresKey: false,
  rateLimit: { requests: 30, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const ip = seed.value

    // PTR record lookup
    try {
      const hostnames = await dns.reverse(ip)
      for (const hostname of hostnames) {
        console.log(`[+] PTR: ${ip} → ${hostname}`)
        nodes.push({ label: 'Domain', key: 'name', props: { name: hostname, source: 'ptr' } })
        edges.push({
          fromLabel: 'IP', fromKey: 'address', fromVal: ip,
          toLabel: 'Domain', toKey: 'name', toVal: hostname, rel: 'RESOLVES_TO',
        })
      }
    } catch {
      console.log(`[-] reverse-dns: no PTR for ${ip}`)
    }

    return { nodes, edges }
  },
}
