import type { Plugin, SeedNode, NodeType, KeyRing } from '@threadr/shared'
import { storeNode, storeEdge } from './graph.js'

const plugins: Plugin[] = []

export function register(p: Plugin) {
  plugins.push(p)
}

export async function runPlugins(seeds: SeedNode[], keys: KeyRing) {
  let nodes = 0
  let edges = 0

  for (const seed of seeds) {
    const applicable = plugins.filter(p => p.accepts.includes(seed.type))

    for (const p of applicable) {
      if (p.requiresKey && !keys.get(p.id)) continue

      try {
        const res = await p.run(seed, keys)

        for (const n of res.nodes) {
          await storeNode(n.label, n.key, n.props)
          nodes++
        }
        for (const e of res.edges) {
          await storeEdge(e.fromLabel, e.fromKey, e.fromVal, e.toLabel, e.toKey, e.toVal, e.rel)
          edges++
        }
      } catch (err) {
        console.log(`[!] ${p.id}: ${(err as Error).message}`)
      }
    }
  }

  return { nodes, edges }
}

export function getPlugins() {
  return plugins.map(p => ({ id: p.id, name: p.name, accepts: p.accepts, requiresKey: p.requiresKey }))
}
