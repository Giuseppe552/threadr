import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import { storeNode, storeEdge } from './graph.js'

export async function runScan(_scanId: string, seed: string) {
  console.log(`[*] scanning: ${seed}`)

  await storeNode('Email', 'address', { address: seed })

  if (seed.includes('@')) {
    const domain = seed.split('@')[1]
    await storeNode('Domain', 'name', { name: domain })
    await storeEdge('Email', 'address', seed, 'Domain', 'name', domain, 'OWNS')
  }

  await ghLookup(seed)

  if (seed.includes('@')) {
    await gravatar(seed)
  }

  const domain = seed.includes('@') ? seed.split('@')[1] : null
  if (domain) {
    await dnsRecords(domain)
    const subs = await crtsh(domain)
    if (subs.length) {
      await resolveSubs(subs)
    }
  }
}

async function ghLookup(email: string) {
  const res = await fetch(
    `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
    { headers: { 'User-Agent': 'threadr/0.1' } }
  )

  if (!res.ok) {
    console.log(`[!] github: ${res.status}`)
    return
  }

  const data = await res.json()
  if (data.total_count === 0) {
    console.log('[-] github: no results')
    return
  }

  for (const user of data.items) {
    console.log(`[+] github: ${user.login}`)

    await storeNode('Username', 'name', {
      name: user.login,
      platform: 'github',
      url: user.html_url,
      avatar: user.avatar_url || '',
    })
    await storeEdge('Email', 'address', email, 'Username', 'name', user.login, 'USES')

    const repoRes = await fetch(user.repos_url, {
      headers: { 'User-Agent': 'threadr/0.1' },
    })
    if (repoRes.ok) {
      const repos = await repoRes.json()
      for (const r of repos.slice(0, 5)) {
        await storeNode('Repository', 'name', { name: r.full_name, url: r.html_url })
        await storeEdge('Username', 'name', user.login, 'Repository', 'name', r.full_name, 'COMMITTED_TO')
      }
    }
  }
}

async function crtsh(domain: string) {
  console.log(`[*] crt.sh: ${domain}`)
  const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`)

  if (!res.ok) {
    console.log(`[!] crt.sh: ${res.status}`)
    return []
  }

  const certs = await res.json()
  const names = new Set<string>()
  for (const c of certs) {
    const val = c.name_value as string
    val.split('\n').forEach((n: string) => names.add(n.toLowerCase()))
  }

  const subs = [...names].filter(n => n !== domain && !n.startsWith('*'))
  console.log(`[+] ${subs.length} subdomains`)
  for (const s of subs.slice(0, 20)) {
    await storeNode('Domain', 'name', { name: s })
    await storeEdge('Domain', 'name', domain, 'Domain', 'name', s, 'HAS_CERT')
  }
  return subs
}

async function resolveSubs(subdomains: string[]) {
  for (const sub of subdomains.slice(0, 15)) {
    try {
      const addrs = await dns.resolve4(sub)
      for (const ip of addrs) {
        console.log(`[+] ${sub} -> ${ip}`)
        await storeNode('IP', 'address', { address: ip })
        await storeEdge('Domain', 'name', sub, 'IP', 'address', ip, 'RESOLVES_TO')
      }
    } catch {
      // nxdomain
    }
  }
}

async function dnsRecords(domain: string) {
  try {
    const mx = await dns.resolveMx(domain)
    for (const m of mx) {
      console.log(`[+] MX: ${m.exchange}`)
      await storeNode('Domain', 'name', { name: m.exchange })
      await storeEdge('Domain', 'name', domain, 'Domain', 'name', m.exchange, 'HAS_MX')
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
    await storeNode('Person', 'name', {
      name: profile.displayName,
      source: 'gravatar',
    })
    await storeEdge('Email', 'address', email, 'Person', 'name', profile.displayName, 'LINKED_TO')
  }
}
