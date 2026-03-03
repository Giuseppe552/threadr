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

async function main() {
  await ghLookup(seed)

  // if seed is an email, pull domain
  const domain = seed.includes('@') ? seed.split('@')[1] : null
  if (domain) {
    await crtsh(domain)
  }
}

main()
