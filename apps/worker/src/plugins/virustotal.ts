import type { Plugin, PluginResult } from '@threadr/shared'

export const virustotal: Plugin = {
  id: 'virustotal',
  name: 'VirusTotal',
  accepts: ['Domain', 'IP'],
  requiresKey: true,
  rateLimit: { requests: 4, windowMs: 60_000 },

  async run(seed, keys): Promise<PluginResult> {
    const result: PluginResult = { nodes: [], edges: [] }
    const key = keys.get('virustotal')
    if (!key) return result

    const type = seed.type === 'Domain' ? 'domains' : 'ip_addresses'
    const res = await fetch(`https://www.virustotal.com/api/v3/${type}/${seed.value}`, {
      headers: { 'x-apikey': key },
    })

    if (res.status === 401 || res.status === 403) {
      keys.markBurned('virustotal', key)
      return result
    }
    if (!res.ok) return result

    const data = await res.json()
    const stats = data.data?.attributes?.last_analysis_stats
    if (!stats) return result

    const malicious = stats.malicious || 0
    const total = (stats.malicious || 0) + (stats.undetected || 0) + (stats.harmless || 0)

    console.log(`[+] virustotal: ${seed.value} — ${malicious}/${total} flagged`)

    const label = seed.type
    const key2 = seed.type === 'Domain' ? 'name' : 'address'
    result.nodes.push({
      label, key: key2,
      props: {
        [key2]: seed.value,
        vt_malicious: String(malicious),
        vt_score: `${malicious}/${total}`,
      },
    })

    return result
  },
}
