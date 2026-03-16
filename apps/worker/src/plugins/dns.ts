import dns from 'node:dns/promises'
import type { Plugin, PluginResult } from '@threadr/shared'

export const dnsPlugin: Plugin = {
  id: 'dns',
  name: 'DNS Records',
  accepts: ['Domain'],
  requiresKey: false,
  rateLimit: { requests: 30, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const domain = seed.value

    // MX records
    try {
      const mx = await dns.resolveMx(domain)
      for (const m of mx) {
        console.log(`[+] MX: ${m.exchange} (pri ${m.priority})`)
        nodes.push({ label: 'Domain', key: 'name', props: { name: m.exchange, mx_priority: String(m.priority) } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: m.exchange, rel: 'HAS_MX',
        })
      }
    } catch { /* no mx */ }

    // A records
    try {
      const addrs = await dns.resolve4(domain)
      for (const ip of addrs) {
        console.log(`[+] A: ${ip}`)
        nodes.push({ label: 'IP', key: 'address', props: { address: ip } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
        })
      }
    } catch { /* no A */ }

    // AAAA records
    try {
      const addrs = await dns.resolve6(domain)
      for (const ip of addrs) {
        console.log(`[+] AAAA: ${ip}`)
        nodes.push({ label: 'IP', key: 'address', props: { address: ip, version: '6' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'IP', toKey: 'address', toVal: ip, rel: 'RESOLVES_TO',
        })
      }
    } catch { /* no AAAA */ }

    // NS records
    try {
      const ns = await dns.resolveNs(domain)
      for (const nameserver of ns) {
        console.log(`[+] NS: ${nameserver}`)
        nodes.push({ label: 'Domain', key: 'name', props: { name: nameserver, role: 'nameserver' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: nameserver, rel: 'USES',
        })
      }
    } catch { /* no NS */ }

    // TXT records — parsed and stored
    try {
      const txt = await dns.resolveTxt(domain)
      const dnsProps: Record<string, string> = {}

      for (const t of txt) {
        const val = t.join('')

        if (val.startsWith('v=spf1')) {
          dnsProps.spf = val
          console.log(`[+] SPF: ${val.slice(0, 100)}`)
          // Extract included domains
          const includes = val.match(/include:([^\s]+)/g)
          if (includes) {
            for (const inc of includes) {
              const spfDomain = inc.replace('include:', '')
              nodes.push({ label: 'Domain', key: 'name', props: { name: spfDomain, role: 'spf-include' } })
              edges.push({
                fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
                toLabel: 'Domain', toKey: 'name', toVal: spfDomain, rel: 'USES',
              })
            }
          }
        }

        if (val.startsWith('v=DMARC1')) {
          dnsProps.dmarc = val
          console.log(`[+] DMARC: ${val.slice(0, 100)}`)
        }

        if (val.includes('v=DKIM1')) {
          dnsProps.dkim = 'present'
          console.log(`[+] DKIM: present`)
        }

        if (val.startsWith('google-site-verification=')) {
          dnsProps.google_verify = val.split('=')[1]
          console.log(`[+] Google verification token`)
        }

        if (val.startsWith('MS=') || val.startsWith('ms=')) {
          dnsProps.ms_verify = val
        }

        if (val.startsWith('facebook-domain-verification=')) {
          dnsProps.fb_verify = val.split('=')[1]
        }
      }

      if (Object.keys(dnsProps).length > 0) {
        nodes.push({ label: 'Domain', key: 'name', props: { name: domain, ...dnsProps } })
      }
    } catch { /* no txt */ }

    // SOA — hostmaster email
    try {
      const soa = await dns.resolveSoa(domain)
      console.log(`[+] SOA: ${soa.hostmaster} serial=${soa.serial}`)
      const hostmaster = soa.hostmaster.replace('.', '@')
      if (hostmaster.includes('@') && !hostmaster.endsWith('@')) {
        nodes.push({ label: 'Email', key: 'address', props: { address: hostmaster, source: 'soa' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Email', toKey: 'address', toVal: hostmaster, rel: 'LINKED_TO',
        })
      }
    } catch { /* no soa */ }

    // CNAME
    try {
      const cnames = await dns.resolveCname(domain)
      for (const cname of cnames) {
        console.log(`[+] CNAME: ${cname}`)
        nodes.push({ label: 'Domain', key: 'name', props: { name: cname, role: 'cname' } })
        edges.push({
          fromLabel: 'Domain', fromKey: 'name', fromVal: domain,
          toLabel: 'Domain', toKey: 'name', toVal: cname, rel: 'RESOLVES_TO',
        })
      }
    } catch { /* most domains use A not CNAME */ }

    return { nodes, edges }
  },
}
