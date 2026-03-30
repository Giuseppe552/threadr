import { detectSeedType } from '@threadr/shared'
import type { SeedNode, NodeType } from '@threadr/shared'
import { storeNode, storeEdge, resetGraphHealth } from './graph.js'
import { register, runPlugins } from './runner.js'
import { keyring } from './keyring.js'

import { github } from './plugins/github.js'
import { crtsh } from './plugins/crtsh.js'
import { dnsPlugin } from './plugins/dns.js'
import { gravatar } from './plugins/gravatar.js'
import { social } from './plugins/social.js'
import { shodan } from './plugins/shodan.js'
import { gitEmails } from './plugins/git-emails.js'
import { whois } from './plugins/whois.js'
import { virustotal } from './plugins/virustotal.js'
import { pgp } from './plugins/pgp.js'
import { hibp } from './plugins/hibp.js'
import { reverseDns } from './plugins/reverse-dns.js'
import { reverseIp } from './plugins/reverse-ip.js'
import { geoip } from './plugins/geoip.js'
import { httpFingerprint } from './plugins/http-fingerprint.js'
import { emailValidation } from './plugins/email-validation.js'
import { securityTrails } from './plugins/security-trails.js'

register(github)
register(crtsh)
register(dnsPlugin)
register(gravatar)
register(social)
register(shodan)
register(gitEmails)
register(whois)
register(virustotal)
register(pgp)
register(hibp)
register(reverseDns)
register(reverseIp)
register(geoip)
register(httpFingerprint)
register(emailValidation)
register(securityTrails)

const seedTypeToNode: Record<string, { label: NodeType; key: string }> = {
  email: { label: 'Email', key: 'address' },
  domain: { label: 'Domain', key: 'name' },
  username: { label: 'Username', key: 'name' },
  phone: { label: 'Phone', key: 'number' },
}

export async function runScan(_scanId: string, seed: string) {
  // Allow neo4j to retry if it was previously marked down
  resetGraphHealth()
  console.log(`[*] scanning: ${seed}`)

  const type = detectSeedType(seed)
  const { label, key } = seedTypeToNode[type]

  await storeNode(label, key, { [key]: seed })
  let nodes = 1
  let edges = 0

  if (type === 'email') {
    const domain = seed.split('@')[1]
    await storeNode('Domain', 'name', { name: domain })
    await storeEdge('Email', 'address', seed, 'Domain', 'name', domain, 'OWNS')
    nodes++
    edges++
  }

  const seeds: SeedNode[] = [{ type: label, key, value: seed }]
  if (type === 'email') {
    seeds.push({ type: 'Domain', key: 'name', value: seed.split('@')[1] })
  }

  const stats = await runPlugins(seeds, keyring)
  nodes += stats.nodes
  edges += stats.edges

  return { nodes, edges }
}
