import type { Plugin, PluginResult } from '@threadr/shared'

export const virustotal: Plugin = {
  id: 'virustotal',
  name: 'VirusTotal',
  accepts: ['Domain', 'IP'],
  requiresKey: true,
  rateLimit: { requests: 4, windowMs: 60_000 },

  async run(seed, keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const key = keys.get('virustotal')
    if (!key) return { nodes, edges }

    const type = seed.type === 'Domain' ? 'domains' : 'ip_addresses'
    const res = await fetch(`https://www.virustotal.com/api/v3/${type}/${seed.value}`, {
      headers: { 'x-apikey': key },
    })

    if (res.status === 401 || res.status === 403) {
      keys.markBurned('virustotal', key)
      return { nodes, edges }
    }
    if (!res.ok) return { nodes, edges }

    const data = await res.json()
    const stats = data.data?.attributes?.last_analysis_stats
    if (!stats) return { nodes, edges }

    const malicious = stats.malicious || 0
    const total = (stats.malicious || 0) + (stats.undetected || 0) + (stats.harmless || 0)

    console.log(`[+] virustotal: ${seed.value} — ${malicious}/${total} flagged`)

    // update the existing node with VT data
    const label = seed.type
    const key2 = seed.type === 'Domain' ? 'name' : 'address'
    nodes.push({
      label, key: key2,
      props: {
        [key2]: seed.value,
        vt_malicious: String(malicious),
        vt_score: `${malicious}/${total}`,
      },
    })

    return { nodes, edges }
  },
}
