import net from 'node:net'
import type { Plugin, PluginResult } from '@threadr/shared'

function query(host: string, data: string, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(43, host)
    let buf = ''
    sock.setTimeout(timeout)
    sock.on('connect', () => sock.write(data + '\r\n'))
    sock.on('data', (chunk) => { buf += chunk.toString() })
    sock.on('end', () => resolve(buf))
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`whois timeout: ${host}`)) })
    sock.on('error', reject)
  })
}

function parseWhois(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([^%#][^:]+):\s*(.+)/)
    if (!m) continue
    const k = m[1].trim().toLowerCase().replace(/\s+/g, '_')
    if (!out[k]) out[k] = m[2].trim()
  }
  return out
}

export const whois: Plugin = {
  id: 'whois',
  name: 'WHOIS',
  accepts: ['Domain'],
  requiresKey: false,
  rateLimit: { requests: 5, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const domain = seed.value

    console.log(`[*] whois: ${domain}`)

    try {
      // step 1: find authoritative server
      const ianaRes = await query('whois.iana.org', domain)
      const referMatch = ianaRes.match(/refer:\s*(\S+)/i)
      const server = referMatch?.[1] || 'whois.verisign-grs.com'

      // step 2: actual lookup
      const raw = await query(server, domain)
      const parsed = parseWhois(raw)

      const registrar = parsed.registrar || parsed.registrar_name
      const created = parsed.creation_date || parsed.created
      const expires = parsed.registry_expiry_date || parsed.expiration_date || parsed.expires
      const registrant = parsed.registrant_name || parsed.registrant_organization

      if (registrar) {
        nodes.push({ label: 'Organization', key: 'name', props: { name: registrar, role: 'registrar' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Organization', toKey: 'name', toVal: registrar, rel: 'OWNS',
        })
      }

      if (registrant && registrant !== registrar) {
        nodes.push({ label: 'Organization', key: 'name', props: { name: registrant, role: 'registrant' } })
        edges.push({
          fromLabel: 'Organization', fromKey: 'name', fromVal: registrant,
          toLabel: 'Domain', toKey: 'name', toVal: domain, rel: 'OWNS',
        })
      }

      // stash dates as props on domain — handy for monitoring changes later
      if (created || expires) {
        const props: Record<string, string> = { name: domain }
        if (created) props.whois_created = created
        if (expires) props.whois_expires = expires
        if (registrar) props.whois_registrar = registrar
        nodes.push({ label: 'Domain', key: 'name', props })
      }
    } catch (err) {
      console.log(`[!] whois: ${(err as Error).message}`)
    }

    return { nodes, edges }
  },
}
