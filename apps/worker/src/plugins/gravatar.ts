import crypto from 'node:crypto'
import type { Plugin, PluginResult } from '@threadr/shared'

export const gravatar: Plugin = {
  id: 'gravatar',
  name: 'Gravatar',
  accepts: ['Email'],
  requiresKey: false,
  rateLimit: { requests: 20, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []

    const hash = crypto.createHash('md5').update(seed.value.trim().toLowerCase()).digest('hex')
    const res = await fetch(`https://gravatar.com/${hash}.json`)
    if (!res.ok) return { nodes, edges }

    const data = await res.json()
    const profile = data.entry?.[0]
    if (profile?.displayName) {
      console.log(`[+] gravatar: ${profile.displayName}`)
      nodes.push({ label: 'Person', key: 'name', props: { name: profile.displayName, source: 'gravatar' } })
      edges.push({
        fromLabel: 'Email', fromKey: 'address', fromVal: seed.value,
        toLabel: 'Person', toKey: 'name', toVal: profile.displayName, rel: 'LINKED_TO',
      })
    }

    return { nodes, edges }
  },
}
