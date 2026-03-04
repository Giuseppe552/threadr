import type { Plugin, SeedNode, NodeType, KeyRing } from '@threadr/shared'
import { storeNode, storeEdge } from './graph.js'
import { resolve } from './resolver.js'

const plugins: Plugin[] = []

export function register(p: Plugin) {
  plugins.push(p)
}

const EXPANDABLE: NodeType[] = ['Username', 'Domain', 'IP', 'Repository']

export async function runPlugins(seeds: SeedNode[], keys: KeyRing) {
  let nodes = 0
  let edges = 0
  const seen = new Set(seeds.map(s => `${s.type}:${s.value}`))

  const runBatch = async (batch: SeedNode[]) => {
    const discovered: SeedNode[] = []

    for (const seed of batch) {
      const applicable = plugins.filter(p => p.accepts.includes(seed.type))

      for (const p of applicable) {
        if (p.requiresKey && !keys.get(p.id)) continue

        try {
          const res = await p.run(seed, keys)

          for (const n of res.nodes) {
            await storeNode(n.label, n.key, n.props)
            nodes++

            const k = `${n.label}:${n.props[n.key]}`
            if (EXPANDABLE.includes(n.label) && !seen.has(k)) {
              seen.add(k)
              discovered.push({ type: n.label, key: n.key, value: n.props[n.key] })
            }
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

    return discovered
  }

  const secondary = await runBatch(seeds)

  // FIXME: should probably cap expansion depth at some point
  if (secondary.length > 0) {
    console.log(`[*] expanding ${secondary.length} discovered nodes`)
    await runBatch(secondary)
  }

  await resolve()

  return { nodes, edges }
}

export function getPlugins() {
  return plugins.map(p => ({ id: p.id, name: p.name, accepts: p.accepts, requiresKey: p.requiresKey }))
}
