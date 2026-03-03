import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import neo4j from 'neo4j-driver'

const seed = process.argv[2]

if (!seed) {
  console.log('usage: threadr <email>')
  process.exit(1)
}

console.log(`\n[*] looking up: ${seed}\n`)

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
    console.log(`    avatar: ${user.avatar_url}`)

    // grab repos
    const repoRes = await fetch(user.repos_url, {
      headers: { 'User-Agent': 'threadr/0.1' },
    })
    if (repoRes.ok) {
      const repos = await res.json()
      for (const r of repos.slice(0, 5)) {
        console.log(`    repo: ${r.full_name}`)
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
  }
  return subs
}

async function resolve(subdomains: string[]) {
  console.log(`\n[*] resolving ${subdomains.length} subdomains`)
  for (const sub of subdomains.slice(0, 15)) {
    try {
      const addrs = await dns.resolve4(sub)
      console.log(`[+] ${sub} -> ${addrs.join(', ')}`)
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
    if (profile.profileUrl) console.log(`    url: ${profile.profileUrl}`)
    if (profile.photos?.[0]) console.log(`    photo: ${profile.photos[0].value}`)
  }
}

// neo4j - trying to store results in graph
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'threadr123')
)

async function storeInGraph(label: string, props: Record<string, string>) {
  const session = driver.session()
  try {
    // TODO: pretty sure CREATE will make dupes, fix later
    await session.run(
      `CREATE (n:${label} $props) RETURN n`,
      { props }
    )
  } finally {
    await session.close()
  }
}

async function main() {
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

  // try storing seed in neo4j
  try {
    await storeInGraph('Email', { address: seed })
    console.log('\n[+] stored in neo4j')
  } catch (e) {
    console.log(`\n[!] neo4j failed: ${e}`)
  }

  await driver.close()
}

main()
