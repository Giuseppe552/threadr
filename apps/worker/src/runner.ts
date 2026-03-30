import type { Plugin, SeedNode, NodeType, KeyRing } from '@threadr/shared'
import { storeNode, storeEdge } from './graph.js'
import { resolve } from './resolver.js'

const plugins: Plugin[] = []

export function register(p: Plugin) {
  plugins.push(p)
}

const EXPANDABLE: NodeType[] = ['Username', 'Domain', 'IP', 'Repository']

const MAX_DEPTH = 2
const MAX_BATCH_SIZE = 200
const MAX_TOTAL_NODES = 2000
const PLUGIN_TIMEOUT_MS = 30_000

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
          const res = await withTimeout(p.run(seed, keys), PLUGIN_TIMEOUT_MS, p.id)

          for (const n of res.nodes) {
            if (nodes >= MAX_TOTAL_NODES) break
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

  let current = seeds
  for (let depth = 0; depth < MAX_DEPTH && current.length > 0; depth++) {
    if (depth > 0) {
      console.log(`[*] depth ${depth}: expanding ${current.length} discovered nodes`)
    }
    if (current.length > MAX_BATCH_SIZE) {
      console.log(`[!] batch ${current.length} exceeds limit, truncating to ${MAX_BATCH_SIZE}`)
      current = current.slice(0, MAX_BATCH_SIZE)
    }
    if (nodes >= MAX_TOTAL_NODES) {
      console.log(`[!] total node limit reached (${nodes}), stopping expansion`)
      break
    }
    current = await runBatch(current)
  }

  await resolve()

  return { nodes, edges }
}

export function getPlugins() {
  return plugins.map(p => ({ id: p.id, name: p.name, accepts: p.accepts, requiresKey: p.requiresKey }))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}
