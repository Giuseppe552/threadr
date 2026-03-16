import type { Plugin, PluginResult } from '@threadr/shared'

/**
 * SecurityTrails — passive DNS history and reverse lookups.
 *
 * This is the single most valuable plugin for real investigations.
 * Historical DNS shows who owned a domain before, what IPs it pointed
 * to over time, and what other domains share the same infrastructure.
 *
 * Free tier: 50 queries/month. Enough for targeted investigations.
 * API: https://securitytrails.com/corp/api
 */
export const securityTrails: Plugin = {
  id: 'securitytrails',
  name: 'SecurityTrails',
  accepts: ['Domain', 'IP'],
  requiresKey: true,
  rateLimit: { requests: 2, windowMs: 60_000 },

  async run(seed, keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const apiKey = keys.get('securitytrails')
    if (!apiKey) return { nodes, edges }

    const headers = { 'apikey': apiKey, 'Accept': 'application/json' }

    if (seed.type === 'Domain') {
      await fetchDomainData(seed.value, headers, nodes, edges)
    } else if (seed.type === 'IP') {
      await fetchIpData(seed.value, headers, nodes, edges)
    }

    return { nodes, edges }
  },
}

async function fetchDomainData(
  domain: string,
  headers: Record<string, string>,
  nodes: PluginResult['nodes'],
  edges: PluginResult['edges'],
) {
  // Subdomains
  try {
    const res = await fetch(`https://api.securitytrails.com/v1/domain/${domain}/subdomains`, { headers })
    if (res.ok) {
      const data = await res.json()
      const subs = data.subdomains || []
      console.log(`[+] securitytrails: ${subs.length} subdomains for ${domain}`)
      for (const sub of subs.slice(0, 100)) {
        const fqdn = `${sub}.${domain}`
        nodes.push({ label: 'Domain', key: 'name', props: { name: fqdn, source: 'securitytrails' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: fqdn, rel: 'HAS_CERT',
        })
      }
    } else if (res.status === 403) {
      console.log(`[!] securitytrails: key rejected`)
    }
  } catch (e) {
    console.log(`[!] securitytrails subdomains: ${(e as Error).message}`)
  }

  // DNS history (A records over time)
  try {
    const res = await fetch(`https://api.securitytrails.com/v1/history/${domain}/dns/a`, { headers })
    if (res.ok) {
      const data = await res.json()
      const records = data.records || []
      console.log(`[+] securitytrails: ${records.length} historical A records for ${domain}`)
      for (const record of records.slice(0, 30)) {
        for (const val of record.values || []) {
          const ip = val.ip
          if (!ip) continue
          const props: Record<string, string> = { address: ip, source: 'dns-history' }
          if (record.first_seen) props.first_seen = record.first_seen
          if (record.last_seen) props.last_seen = record.last_seen
          nodes.push({ label: 'IP', key: 'address', props })
          edges.push({
            fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
            toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
          })
        }
      }
    }
  } catch (e) {
    console.log(`[!] securitytrails dns-history: ${(e as Error).message}`)
  }

  // Associated domains (same registrant, nameserver, or MX)
  try {
    const res = await fetch(`https://api.securitytrails.com/v1/domain/${domain}/associated`, { headers })
    if (res.ok) {
      const data = await res.json()
      const associated = data.records || []
      console.log(`[+] securitytrails: ${associated.length} associated domains for ${domain}`)
      for (const record of associated.slice(0, 30)) {
        const assocDomain = record.hostname
        if (!assocDomain || assocDomain === domain) continue
        nodes.push({ label: 'Domain', key: 'name', props: { name: assocDomain, source: 'associated' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: assocDomain, rel: 'LINKED_TO',
        })
      }
    }
  } catch (e) {
    console.log(`[!] securitytrails associated: ${(e as Error).message}`)
  }
}

async function fetchIpData(
  ip: string,
  headers: Record<string, string>,
  nodes: PluginResult['nodes'],
  edges: PluginResult['edges'],
) {
  // Domains currently pointing to this IP
  try {
    const res = await fetch(`https://api.securitytrails.com/v1/domains/list?include=current_dns&filter[ipv4]=${ip}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { ipv4: ip } }),
    })

    // Fallback: use search endpoint
    const searchRes = await fetch(`https://api.securitytrails.com/v1/search/list`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { ipv4: ip } }),
    })

    if (searchRes.ok) {
      const data = await searchRes.json()
      const records = data.records || []
      console.log(`[+] securitytrails: ${records.length} domains on ${ip}`)
      for (const record of records.slice(0, 50)) {
        const domain = record.hostname
        if (!domain) continue
        nodes.push({ label: 'Domain', key: 'name', props: { name: domain, source: 'securitytrails' } })
        edges.push({
          fromLabel: 'IP', fromKey: 'address', fromVal: ip,
          toLabel: 'Domain', toKey: 'name', toVal: domain, rel: 'RESOLVES_TO',
        })
      }
    }
  } catch (e) {
    console.log(`[!] securitytrails ip-search: ${(e as Error).message}`)
  }
}
