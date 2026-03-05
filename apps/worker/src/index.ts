import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import neo4j from 'neo4j-driver'

const seed = process.argv[2]

if (!seed) {
  console.log('usage: threadr <email|domain|username>')
  process.exit(1)
}

console.log(`\n[*] looking up: ${seed}\n`)

// neo4j - optional, won't crash if not running
const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

let graphUp = true

async function storeNode(label: string, key: string, props: Record<string, string>) {
  if (!graphUp) return
  const session = driver.session()
  try {
    await session.run(
      `MERGE (n:${label} {${key}: $val}) SET n += $props RETURN n`,
      { val: props[key], props }
    )
  } catch (e) {
    console.log(`[!] neo4j write failed, disabling: ${(e as Error).message}`)
    graphUp = false
  } finally {
    await session.close()
  }
}

async function storeEdge(
  fromLabel: string, fromKey: string, fromVal: string,
  toLabel: string, toKey: string, toVal: string,
  rel: string
) {
  if (!graphUp) return
  const session = driver.session()
  try {
    await session.run(
      `MATCH (a:${fromLabel} {${fromKey}: $fv})
       MATCH (b:${toLabel} {${toKey}: $tv})
       MERGE (a)-[:${rel}]->(b)`,
      { fv: fromVal, tv: toVal }
    )
  } finally {
    await session.close()
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
    console.log(`[+] github user: ${user.login}`)
    console.log(`    profile: ${user.html_url}`)

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
        console.log(`    repo: ${r.full_name}`)
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
    console.log(`    ${s}`)
    await storeNode('Domain', 'name', { name: s })
    await storeEdge('Domain', 'name', domain, 'Domain', 'name', s, 'HAS_CERT')
  }
  return subs
}

async function resolveSubs(subdomains: string[]) {
  console.log(`\n[*] resolving ${subdomains.length} subdomains`)
  for (const sub of subdomains.slice(0, 15)) {
    try {
      const addrs = await dns.resolve4(sub)
      for (const ip of addrs) {
        console.log(`[+] ${sub} -> ${ip}`)
        await storeNode('IP', 'address', { address: ip })
        await storeEdge('Domain', 'name', sub, 'IP', 'address', ip, 'RESOLVES_TO')
      }
    } catch {
      // nxdomain, skip
    }
  }
}

async function dnsRecords(domain: string) {
  console.log(`\n[*] dns records: ${domain}`)
  try {
    const mx = await dns.resolveMx(domain)
    for (const m of mx) {
      console.log(`[+] MX: ${m.exchange} (pri ${m.priority})`)
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
  console.log(`[*] gravatar: ${hash}`)

  const res = await fetch(`https://gravatar.com/${hash}.json`)
  if (res.status === 404) {
    console.log('[-] gravatar: no profile')
    return
  }
  if (!res.ok) {
    console.log(`[!] gravatar: ${res.status}`)
    return
  }

  const data = await res.json()
  const profile = data.entry?.[0]
  if (profile) {
    console.log(`[+] gravatar: ${profile.displayName || 'unknown'}`)
    if (profile.displayName) {
      await storeNode('Person', 'name', {
        name: profile.displayName,
        source: 'gravatar',
      })
      await storeEdge('Email', 'address', email, 'Person', 'name', profile.displayName, 'LINKED_TO')
    }
  }
}

async function main() {
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

  console.log('\n[*] done')
  await driver.close()
}

main()
