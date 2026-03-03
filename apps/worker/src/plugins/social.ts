import type { Plugin, PluginResult } from '@threadr/shared'

const PLATFORMS = [
  { name: 'twitter', url: (u: string) => `https://x.com/${u}` },
  { name: 'github', url: (u: string) => `https://github.com/${u}` },
  { name: 'linkedin', url: (u: string) => `https://linkedin.com/in/${u}` },
  { name: 'reddit', url: (u: string) => `https://reddit.com/user/${u}` },
  { name: 'hackernews', url: (u: string) => `https://news.ycombinator.com/user?id=${u}` },
  { name: 'keybase', url: (u: string) => `https://keybase.io/${u}` },
  { name: 'gitlab', url: (u: string) => `https://gitlab.com/${u}` },
  { name: 'dev.to', url: (u: string) => `https://dev.to/${u}` },
]

export const social: Plugin = {
  id: 'social',
  name: 'Social Profiles',
  accepts: ['Username'],
  requiresKey: false,
  rateLimit: { requests: 20, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const username = seed.value

    console.log(`[*] social: checking ${username}`)

    for (const p of PLATFORMS) {
      try {
        const res = await fetch(p.url(username), {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'User-Agent': 'threadr/0.1' },
        })

        if (res.status === 200) {
          console.log(`[+] ${p.name}: found`)
          nodes.push({
            label: 'Username', key: 'name',
            props: { name: username, platform: p.name, url: p.url(username) },
          })
          edges.push({
            fromLabel: 'Username', fromKey: 'name', fromVal: username,
            toLabel: 'Username', toKey: 'name', toVal: username, rel: 'LINKED_TO',
          })
        }
      } catch {
        // timeout, skip
      }
    }

    return { nodes, edges }
  },
}
