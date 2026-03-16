import type { Plugin, PluginResult } from '@threadr/shared'

/**
 * IP geolocation via ip-api.com (free, no key, 45 req/min).
 * Returns country, city, ISP, AS number, and coordinates.
 */
export const geoip: Plugin = {
  id: 'geoip',
  name: 'IP Geolocation',
  accepts: ['IP'],
  requiresKey: false,
  rateLimit: { requests: 40, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []
    const ip = seed.value

    try {
      const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,asname,hosting`)
      if (!res.ok) return { nodes, edges }

      const data = await res.json()
      if (data.status !== 'success') return { nodes, edges }

      console.log(`[+] geoip: ${ip} → ${data.city}, ${data.country} (AS${data.as?.split(' ')[0]?.replace('AS', '') || '?'})`)

      // Enrich the IP node with geo properties
      const props: Record<string, string> = { address: ip }
      if (data.country) props.country = data.country
      if (data.countryCode) props.country_code = data.countryCode
      if (data.regionName) props.region = data.regionName
      if (data.city) props.city = data.city
      if (data.lat) props.lat = String(data.lat)
      if (data.lon) props.lon = String(data.lon)
      if (data.isp) props.isp = data.isp
      if (data.as) props.asn = data.as
      if (data.asname) props.as_name = data.asname
      if (data.hosting !== undefined) props.hosting = String(data.hosting)

      nodes.push({ label: 'IP', key: 'address', props })

      // Create Organization node for the ISP/AS owner
      if (data.org) {
        nodes.push({ label: 'Organization', key: 'name', props: { name: data.org, role: 'isp' } })
        edges.push({
          fromLabel: 'IP', fromKey: 'address', fromVal: ip,
          toLabel: 'Organization', toKey: 'name', toVal: data.org, rel: 'OWNS',
        })
      }
    } catch (e) {
      console.log(`[!] geoip: ${(e as Error).message}`)
    }

    return { nodes, edges }
  },
}
