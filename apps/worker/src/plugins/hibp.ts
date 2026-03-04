import type { Plugin, PluginResult } from '@threadr/shared'

export const hibp: Plugin = {
  id: 'hibp',
  name: 'Have I Been Pwned',
  accepts: ['Email'],
  requiresKey: true,
  rateLimit: { requests: 10, windowMs: 60_000 },

  async run(seed, keys): Promise<PluginResult> {
    const key = keys.get('hibp')
    if (!key) return { nodes: [], edges: [] }

    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(seed.value)}?truncateResponse=false`,
      { headers: { 'hibp-api-key': key, 'User-Agent': 'threadr/0.1' } }
    )

    if (res.status === 401 || res.status === 403) {
      keys.markBurned('hibp', key)
      return { nodes: [], edges: [] }
    }
    if (res.status === 404) return { nodes: [], edges: [] } // no breaches
    if (!res.ok) return { nodes: [], edges: [] }

    const breaches: { Name: string; BreachDate: string; DataClasses: string[] }[] = await res.json()
    const out: PluginResult = { nodes: [], edges: [] }

    for (const b of breaches) {
      console.log(`[+] hibp: ${seed.value} in ${b.Name}`)
      out.nodes.push({
        label: 'Breach', key: 'name',
        props: { name: b.Name, date: b.BreachDate, data_classes: b.DataClasses.join(', ') },
      })
      out.edges.push({
        fromLabel: 'Email', fromKey: 'address', fromVal: seed.value,
        toLabel: 'Breach', toKey: 'name', toVal: b.Name, rel: 'EXPOSED_IN',
      })
    }

    return out
  },
}
