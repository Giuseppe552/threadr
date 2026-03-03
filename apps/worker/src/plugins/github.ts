import type { Plugin, PluginResult } from '@threadr/shared'

export const github: Plugin = {
  id: 'github',
  name: 'GitHub',
  accepts: ['Email'],
  requiresKey: false,
  rateLimit: { requests: 10, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []

    const res = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(seed.value)}+in:email`,
      { headers: { 'User-Agent': 'threadr/0.1' } }
    )

    if (!res.ok) {
      console.log(`[!] github: ${res.status}`)
      return { nodes, edges }
    }

    const data = await res.json()
    if (data.total_count === 0) return { nodes, edges }

    for (const user of data.items) {
      console.log(`[+] github: ${user.login}`)

      nodes.push({
        label: 'Username', key: 'name',
        props: { name: user.login, platform: 'github', url: user.html_url, avatar: user.avatar_url || '' },
      })
      edges.push({
        fromLabel: 'Email', fromKey: 'address', fromVal: seed.value,
        toLabel: 'Username', toKey: 'name', toVal: user.login, rel: 'USES',
      })

      // grab repos
      const repoRes = await fetch(user.repos_url, { headers: { 'User-Agent': 'threadr/0.1' } })
      if (!repoRes.ok) continue

      const repos = await repoRes.json()
      for (const r of repos.slice(0, 5)) {
        nodes.push({ label: 'Repository', key: 'name', props: { name: r.full_name, url: r.html_url } })
        edges.push({
          fromLabel: 'Username', fromKey: 'name', fromVal: user.login,
          toLabel: 'Repository', toKey: 'name', toVal: r.full_name, rel: 'COMMITTED_TO',
        })
      }
    }

    return { nodes, edges }
  },
}
