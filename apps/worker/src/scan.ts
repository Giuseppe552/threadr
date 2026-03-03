import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import { storeNode, storeEdge } from './graph.js'
import { runPlugins } from './runner.js'

let nodeCount = 0
let edgeCount = 0

async function trackNode(label: string, key: string, props: Record<string, string>) {
  await storeNode(label, key, props)
  nodeCount++
}

async function trackEdge(
  fl: string, fk: string, fv: string,
  tl: string, tk: string, tv: string,
  rel: string
) {
  await storeEdge(fl, fk, fv, tl, tk, tv, rel)
  edgeCount++
}

export async function runScan(_scanId: string, seed: string) {
  nodeCount = 0
  edgeCount = 0
  console.log(`[*] scanning: ${seed}`)

  await trackNode('Email', 'address', { address: seed })

  if (seed.includes('@')) {
    const domain = seed.split('@')[1]
    await trackNode('Domain', 'name', { name: domain })
    await trackEdge('Email', 'address', seed, 'Domain', 'name', domain, 'OWNS')
  }

  // github + crtsh moved to plugins, social still inline for now
  if (seed.includes('@')) {
    await gravatar(seed)
  }

  const domain = seed.includes('@') ? seed.split('@')[1] : null
  if (domain) {
    await dnsRecords(domain)
  }

  return { nodes: nodeCount, edges: edgeCount }
}


async function dnsRecords(domain: string) {
  try {
    const mx = await dns.resolveMx(domain)
    for (const m of mx) {
      console.log(`[+] MX: ${m.exchange}`)
      await trackNode('Domain', 'name', { name: m.exchange })
      await trackEdge('Domain', 'name', domain, 'Domain', 'name', m.exchange, 'HAS_MX')
    }
  } catch { /* no mx */ }

  try {
    const txt = await dns.resolveTxt(domain)
    for (const t of txt) {
      const val = t.join('')
      if (val.includes('v=spf') || val.includes('google') || val.includes('microsoft')) {
        console.log(`[+] TXT: ${val.slice(0, 80)}`)
      }
    }
  } catch { /* no txt */ }
}

async function gravatar(email: string) {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex')
  const res = await fetch(`https://gravatar.com/${hash}.json`)

  if (!res.ok) return

  const data = await res.json()
  const profile = data.entry?.[0]
  if (profile?.displayName) {
    console.log(`[+] gravatar: ${profile.displayName}`)
    await trackNode('Person', 'name', {
      name: profile.displayName,
      source: 'gravatar',
    })
    await trackEdge('Email', 'address', email, 'Person', 'name', profile.displayName, 'LINKED_TO')
  }
}
