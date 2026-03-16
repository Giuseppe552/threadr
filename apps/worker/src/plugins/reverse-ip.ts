import type { Plugin, PluginResult } from '@threadr/shared'

/**
 * Reverse IP lookup — finds other domains hosted on the same IP.
 * Uses HackerTarget's free API (no key, 100 req/day).
 * Essential for shared hosting discovery and infrastructure mapping.
 */
export const reverseIp: Plugin = {
  id: 'reverse-ip',
  name: 'Reverse IP Lookup',
  accepts: ['IP'],
  requiresKey: false,
  rateLimit: { requests: 5, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const ip = seed.value

    try {
      const res = await fetch(`https://api.hackertarget.com/reverseiplookup/?q=${ip}`)
      if (!res.ok) return { nodes, edges }

      const text = await res.text()

      // HackerTarget returns one domain per line, or "error" messages
      if (text.startsWith('error') || text.startsWith('API count') || text.includes('No DNS A records')) {
        return { nodes, edges }
      }

      const domains = text.split('\n')
        .map(d => d.trim().toLowerCase())
        .filter(d => d && d.includes('.') && !d.includes(' '))

      console.log(`[+] reverse-ip: ${ip} → ${domains.length} domains`)

      for (const domain of domains.slice(0, 50)) {
        nodes.push({ label: 'Domain', key: 'name', props: { name: domain, source: 'reverse-ip' } })
        edges.push({
          fromLabel: 'IP', fromKey: 'address', fromVal: ip,
          toLabel: 'Domain', toKey: 'name', toVal: domain, rel: 'RESOLVES_TO',
        })
      }
    } catch (e) {
      console.log(`[!] reverse-ip: ${(e as Error).message}`)
    }

    return { nodes, edges }
  },
}
