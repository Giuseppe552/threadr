import { detectSeedType } from '@threadr/shared'
import type { SeedNode, NodeType } from '@threadr/shared'
import { storeNode, storeEdge } from './graph.js'
import { runPlugins } from './runner.js'
import { keyring } from './keyring.js'

const seedTypeToNode: Record<string, { label: NodeType; key: string }> = {
  email: { label: 'Email', key: 'address' },
  domain: { label: 'Domain', key: 'name' },
  username: { label: 'Username', key: 'name' },
  phone: { label: 'Phone', key: 'number' },
}

export async function runScan(_scanId: string, seed: string) {
  console.log(`[*] scanning: ${seed}`)

  const type = detectSeedType(seed)
  const { label, key } = seedTypeToNode[type]

  // create seed node
  await storeNode(label, key, { [key]: seed })
  let nodes = 1
  let edges = 0

  // if email, also create domain node + edge
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
