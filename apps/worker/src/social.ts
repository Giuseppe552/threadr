import { storeNode, storeEdge } from './graph.js'

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

export async function checkSocial(username: string) {
  console.log(`[*] social: checking ${username}`)

  for (const platform of PLATFORMS) {
    try {
      const res = await fetch(platform.url(username), {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'threadr/0.1' },
      })

      if (res.status === 200) {
        console.log(`[+] ${platform.name}: found`)
        await storeNode('Username', 'name', {
          name: username,
          platform: platform.name,
          url: platform.url(username),
        })
        // link to original username node if different platform
        await storeEdge(
          'Username', 'name', username,
          'Username', 'name', username,
          'LINKED_TO'
        )
      }
    } catch {
      // timeout or network error, skip
    }
  }
}
