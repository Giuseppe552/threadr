import type { Plugin, PluginResult } from '@threadr/shared'

export const shodan: Plugin = {
  id: 'shodan',
  name: 'Shodan',
  accepts: ['IP', 'Domain'],
  requiresKey: true,
  rateLimit: { requests: 1, windowMs: 1_000 }, // free tier is brutal

  async run(seed, keys): Promise<PluginResult> {
    const out: PluginResult = { nodes: [], edges: [] }
    const key = keys.get('shodan')
    if (!key) return out

    let ip = seed.value

    if (seed.type === 'Domain') {
      try {
        const res = await fetch(`https://api.shodan.io/dns/resolve?hostnames=${seed.value}&key=${key}`)
        if (res.status === 401 || res.status === 403) {
          keys.markBurned('shodan', key)
          return out
        }
        if (!res.ok) return out
        const data = await res.json()
        ip = data[seed.value]
        if (!ip) return out
      } catch { return out }
    }

    console.log(`[*] shodan: ${ip}`)

    const res = await fetch(`https://api.shodan.io/shodan/host/${ip}?key=${key}`)
    if (res.status === 401 || res.status === 403) {
      keys.markBurned('shodan', key)
      return out
    }
    if (res.status === 429) throw new Error('shodan rate limited')
    if (!res.ok) return out

    const host = await res.json()

    if (seed.type === 'Domain') {
      out.nodes.push({ label: 'IP', key: 'address', props: { address: ip } })
      out.edges.push({
        fromLabel: 'Domain', fromKey: 'name', fromVal: seed.value,
        toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
      })
    }

    if (host.org) {
      out.nodes.push({ label: 'Organization', key: 'name', props: { name: host.org } })
      out.edges.push({
        fromLabel: 'IP', fromKey: 'address', fromVal: ip,
        toLabel: 'Organization', toKey: 'name', toVal: host.org, rel: 'OWNS',
      })
    }

    for (const svc of (host.data || []).slice(0, 15)) {
      const portKey = `${ip}:${svc.port}`
      out.nodes.push({
        label: 'Port', key: 'name',
        props: {
          name: portKey,
          number: String(svc.port),
          protocol: svc.transport || 'tcp',
          service: svc.product || svc._shodan?.module || '',
          banner: (svc.data || '').slice(0, 200),
        },
      })
      out.edges.push({
        fromLabel: 'IP', fromKey: 'address', fromVal: ip,
        toLabel: 'Port', toKey: 'name', toVal: portKey, rel: 'OPEN_PORT',
      })
    }

    return out
  },
}
