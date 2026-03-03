import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import neo4j from 'neo4j-driver'

const seed = process.argv[2]

if (!seed) {
  console.log('usage: threadr <email>')
  process.exit(1)
}

console.log(`\n[*] looking up: ${seed}\n`)

// neo4j
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'threadr123')
)

async function storeNode(label: string, key: string, props: Record<string, string>) {
  const session = driver.session()
  try {
    await session.run(
      `MERGE (n:${label} {${key}: $val}) SET n += $props RETURN n`,
      { val: props[key], props }
    )
  } finally {
    await session.close()
  }
}

async function storeEdge(
  fromLabel: string, fromKey: string, fromVal: string,
  toLabel: string, toKey: string, toVal: string,
  rel: string
) {
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

// github search
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

    // grab repos
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

// crt.sh cert transparency
async function crtsh(domain: string) {
  console.log(`[*] crt.sh lookup: ${domain}`)
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
  console.log(`[+] found ${subs.length} subdomains`)
  for (const s of subs.slice(0, 20)) {
    console.log(`    ${s}`)
    await storeNode('Domain', 'name', { name: s })
    await storeEdge('Domain', 'name', domain, 'Domain', 'name', s, 'HAS_CERT')
  }
  return subs
}

async function resolve(subdomains: string[]) {
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
      // nxdomain or timeout, skip
    }
  }
}

async function gravatar(email: string) {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex')
  const url = `https://gravatar.com/${hash}.json`
  console.log(`\n[*] gravatar: ${hash}`)

  const res = await fetch(url)
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
  // store seed node first
  try {
    await storeNode('Email', 'address', { address: seed })
  } catch (e) {
    console.log(`[!] neo4j not running, skipping graph storage: ${e}`)
    // still run lookups even without neo4j
  }

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
    const subs = await crtsh(domain)
    if (subs.length) {
      await resolve(subs)
    }
  }

  console.log('\n[*] done')
  await driver.close()
}

main()
