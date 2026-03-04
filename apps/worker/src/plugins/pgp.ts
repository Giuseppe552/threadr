import type { Plugin, PluginResult } from '@threadr/shared'

export const pgp: Plugin = {
  id: 'pgp',
  name: 'PGP Keyserver',
  accepts: ['Email'],
  requiresKey: false,
  rateLimit: { requests: 10, windowMs: 60_000 },

  async run(seed, _keys): Promise<PluginResult> {
    const nodes: PluginResult['nodes'] = []
    const edges: PluginResult['edges'] = []

    const url = `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(seed.value)}`
    const res = await fetch(url)
    if (!res.ok) return { nodes, edges }

    // HKP machine-readable index
    const hkpUrl = `https://keys.openpgp.org/pks/lookup?op=index&options=mr&search=${encodeURIComponent(seed.value)}`
    const hkpRes = await fetch(hkpUrl)
    if (!hkpRes.ok) return { nodes, edges }

    const body = await hkpRes.text()

    for (const line of body.split('\n')) {
      if (line.startsWith('pub:')) {
        const parts = line.split(':')
        const keyId = parts[1] || ''
        const created = parts[4] || ''
        console.log(`[+] pgp: key ${keyId.slice(-8)}`)
        nodes.push({
          label: 'Certificate', key: 'name',
          props: { name: `pgp:${keyId.slice(-16)}`, key_id: keyId, created, type: 'pgp' },
        })
        edges.push({
          fromLabel: 'Email', fromKey: 'address', fromVal: seed.value,
          toLabel: 'Certificate', toKey: 'name', toVal: `pgp:${keyId.slice(-16)}`, rel: 'HAS_CERT',
        })
      }
      if (line.startsWith('uid:')) {
        const parts = line.split(':')
        const raw = parts[1] || ''
        const decoded = decodeURIComponent(raw.replace(/\+/g, ' '))
        const nameMatch = decoded.match(/^([^<]+)/)
        const name = nameMatch?.[1]?.trim()
        if (name && name !== seed.value) {
          nodes.push({ label: 'Person', key: 'name', props: { name, source: 'pgp' } })
          edges.push({
            fromLabel: 'Email', fromKey: 'address', fromVal: seed.value,
            toLabel: 'Person', toKey: 'name', toVal: name, rel: 'LINKED_TO',
          })
        }
      }
    }

    return { nodes, edges }
  },
}
