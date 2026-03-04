import type { Plugin, PluginResult } from '@threadr/shared'

export const shodan: Plugin = {
  id: 'shodan',
  name: 'Shodan',
  accepts: ['IP', 'Domain'],
  requiresKey: true,
  rateLimit: { requests: 1, windowMs: 1_000 },

  async run(seed, keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const key = keys.get('shodan')
    if (!key) return { nodes, edges }

    let ip = seed.value

    // if domain, resolve to IP first
    if (seed.type === 'Domain') {
      try {
        const res = await fetch(`https://api.shodan.io/dns/resolve?hostnames=${seed.value}&key=${key}`)
        if (res.status === 401 || res.status === 403) {
          keys.markBurned('shodan', key)
          return { nodes, edges }
        }
        if (!res.ok) return { nodes, edges }
        const data = await res.json()
        ip = data[seed.value]
        if (!ip) return { nodes, edges }
      } catch { return { nodes, edges } }
    }

    console.log(`[*] shodan: ${ip}`)

    const res = await fetch(`https://api.shodan.io/shodan/host/${ip}?key=${key}`)
    if (res.status === 401 || res.status === 403) {
      keys.markBurned('shodan', key)
      return { nodes, edges }
    }
    if (res.status === 429) throw new Error('shodan rate limited')
    if (!res.ok) return { nodes, edges }

    const host = await res.json()

    // create IP node if we resolved from domain
    if (seed.type === 'Domain') {
      nodes.push({ label: 'IP', key: 'address', props: { address: ip } })
      edges.push({
        fromLabel: 'Domain', fromKey: 'name', fromVal: seed.value,
        toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
      })
    }

    if (host.org) {
      nodes.push({ label: 'Organization', key: 'name', props: { name: host.org } })
      edges.push({
        fromLabel: 'IP', fromKey: 'address', fromVal: ip,
        toLabel: 'Organization', toKey: 'name', toVal: host.org, rel: 'OWNS',
      })
    }

    for (const svc of (host.data || []).slice(0, 15)) {
      const portKey = `${ip}:${svc.port}`
      nodes.push({
        label: 'Port', key: 'name',
        props: {
          name: portKey,
          number: String(svc.port),
          protocol: svc.transport || 'tcp',
          service: svc.product || svc._shodan?.module || '',
          banner: (svc.data || '').slice(0, 200),
        },
      })
      edges.push({
        fromLabel: 'IP', fromKey: 'address', fromVal: ip,
        toLabel: 'Port', toKey: 'name', toVal: portKey, rel: 'OPEN_PORT',
      })
    }

    return { nodes, edges }
  },
}
