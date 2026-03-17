#!/usr/bin/env node
/**
 * threadr CLI — headless scan without browser, queue, or API server.
 *
 * Usage:
 *   threadr scan <seed>                     # scan, output JSON
 *   threadr scan <seed> --format graphml    # scan, output GraphML
 *   threadr scan <seed> --depth 3           # expansion depth (default 2)
 *   threadr scan <seed> --plugins dns,whois # only run these plugins
 *   threadr scan <seed> --quiet             # suppress log output
 *   threadr plugins                         # list available plugins
 *   threadr graph <seed>                    # dump existing graph as JSON
 *
 * Requires Neo4j running. Does NOT require Redis or the API server.
 * Reads .env for NEO4J_URL, NEO4J_PASS, and API keys.
 */

import { detectSeedType, toGraphML } from '@threadr/shared'
import type { SeedNode, NodeType, Plugin } from '@threadr/shared'
import { storeNode, storeEdge, close as closeGraph } from './graph.js'
import { loadKeysFromDb, keyring } from './keyring.js'
import { resolve } from './resolver.js'

// Import all plugins
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

// Neo4j graph retrieval (duplicated from api/graph.ts to avoid cross-package import)
import neo4j from 'neo4j-driver'

const ALL_PLUGINS: Plugin[] = [
  github, crtsh, dnsPlugin, gravatar, social, shodan,
  gitEmails, whois, virustotal, pgp, hibp,
  reverseDns, reverseIp, geoip, httpFingerprint, emailValidation, securityTrails,
]

const EXPANDABLE: NodeType[] = ['Username', 'Domain', 'IP', 'Repository']

interface CliOpts {
  command: string
  seed: string
  format: 'json' | 'graphml'
  depth: number
  plugins: string[] | null // null = all
  quiet: boolean
}

function parseArgs(argv: string[]): CliOpts {
  const args = argv.slice(2) // skip node + script
  const opts: CliOpts = {
    command: args[0] || 'help',
    seed: args[1] || '',
    format: 'json',
    depth: 2,
    plugins: null,
    quiet: false,
  }

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case '--format':
      case '-f':
        opts.format = args[++i] === 'graphml' ? 'graphml' : 'json'
        break
      case '--depth':
      case '-d':
        opts.depth = parseInt(args[++i], 10) || 2
        break
      case '--plugins':
      case '-p':
        opts.plugins = args[++i].split(',').map(s => s.trim())
        break
      case '--quiet':
      case '-q':
        opts.quiet = true
        break
    }
  }

  return opts
}

function log(quiet: boolean, msg: string) {
  if (!quiet) process.stderr.write(msg + '\n')
}

async function getGraph(seedVal: string) {
  const driver = neo4j.driver(
    process.env.NEO4J_URL || 'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
  )
  const session = driver.session()
  try {
    const res = await session.run(
      `MATCH path = (root)-[*0..3]-()
       WHERE root.address = $val OR root.name = $val
       WITH nodes(path) AS ns, relationships(path) AS rs
       UNWIND ns AS n
       WITH COLLECT(DISTINCT n) AS nodes, rs
       UNWIND rs AS r
       WITH nodes, COLLECT(DISTINCT r) AS rels
       RETURN nodes, rels`,
      { val: seedVal }
    )

    if (res.records.length === 0) return { nodes: [], edges: [] }

    const record = res.records[0]
    const nodes = (record.get('nodes') as neo4j.Node[]).map(n => ({
      id: n.elementId,
      label: n.labels[0],
      props: n.properties as Record<string, string>,
    }))
    const edges = (record.get('rels') as neo4j.Relationship[]).map(r => ({
      from: r.startNodeElementId,
      to: r.endNodeElementId,
      type: r.type,
      ...r.properties as Record<string, string>,
    }))

    return { nodes, edges }
  } finally {
    await session.close()
    await driver.close()
  }
}

const seedTypeToNode: Record<string, { label: NodeType; key: string }> = {
  email: { label: 'Email', key: 'address' },
  domain: { label: 'Domain', key: 'name' },
  username: { label: 'Username', key: 'name' },
  phone: { label: 'Phone', key: 'number' },
}

async function runDirectScan(opts: CliOpts) {
  const { seed, depth, plugins: pluginFilter, quiet } = opts
  if (!seed) {
    process.stderr.write('error: seed required\n')
    process.exit(1)
  }

  loadKeysFromDb()

  const type = detectSeedType(seed)
  const { label, key } = seedTypeToNode[type]

  log(quiet, `[*] scanning: ${seed} (type=${type}, depth=${depth})`)

  // Store seed node
  await storeNode(label, key, { [key]: seed })

  if (type === 'email') {
    const domain = seed.split('@')[1]
    await storeNode('Domain', 'name', { name: domain })
    await storeEdge('Email', 'address', seed, 'Domain', 'name', domain, 'OWNS')
  }

  // Filter plugins if requested
  let activePlugins = ALL_PLUGINS
  if (pluginFilter) {
    activePlugins = ALL_PLUGINS.filter(p => pluginFilter.includes(p.id))
    log(quiet, `[*] active plugins: ${activePlugins.map(p => p.id).join(', ')}`)
  }

  // Run scan with expansion
  const seen = new Set<string>()
  let seeds: SeedNode[] = [{ type: label, key, value: seed }]
  if (type === 'email') {
    seeds.push({ type: 'Domain', key: 'name', value: seed.split('@')[1] })
  }
  seeds.forEach(s => seen.add(`${s.type}:${s.value}`))

  let totalNodes = 0
  let totalEdges = 0

  for (let d = 0; d < depth; d++) {
    if (seeds.length === 0) break
    log(quiet, `[*] depth ${d + 1}/${depth}: ${seeds.length} seeds`)

    const discovered: SeedNode[] = []

    for (const s of seeds) {
      const applicable = activePlugins.filter(p => p.accepts.includes(s.type))

      for (const plugin of applicable) {
        if (plugin.requiresKey && !keyring.get(plugin.id)) continue

        try {
          const res = await plugin.run(s, keyring)

          for (const n of res.nodes) {
            await storeNode(n.label, n.key, n.props)
            totalNodes++

            const k = `${n.label}:${n.props[n.key]}`
            if (EXPANDABLE.includes(n.label) && !seen.has(k)) {
              seen.add(k)
              discovered.push({ type: n.label, key: n.key, value: n.props[n.key] })
            }
          }
          for (const e of res.edges) {
            await storeEdge(e.fromLabel, e.fromKey, e.fromVal, e.toLabel, e.toKey, e.toVal, e.rel)
            totalEdges++
          }
        } catch (err) {
          log(quiet, `[!] ${plugin.id}: ${(err as Error).message}`)
        }
      }
    }

    seeds = discovered
  }

  // Entity resolution
  log(quiet, `[*] resolving entities...`)
  await resolve()

  log(quiet, `[*] done: ${totalNodes} nodes, ${totalEdges} edges`)

  // Fetch the final graph and output
  const graph = await getGraph(seed)

  if (opts.format === 'graphml') {
    const xml = toGraphML(graph.nodes, graph.edges)
    process.stdout.write(xml)
  } else {
    const output = {
      seed,
      seed_type: type,
      scanned_at: new Date().toISOString(),
      stats: { nodes: graph.nodes.length, edges: graph.edges.length },
      nodes: graph.nodes,
      edges: graph.edges,
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n')
  }

  await closeGraph()
}

async function listPlugins() {
  for (const p of ALL_PLUGINS) {
    const key = p.requiresKey ? ' [KEY]' : ''
    console.log(`  ${p.id.padEnd(20)} ${p.accepts.join(', ').padEnd(25)} ${p.name}${key}`)
  }
}

async function dumpGraph(opts: CliOpts) {
  if (!opts.seed) {
    process.stderr.write('error: seed required\n')
    process.exit(1)
  }
  const graph = await getGraph(opts.seed)
  if (opts.format === 'graphml') {
    process.stdout.write(toGraphML(graph.nodes, graph.edges))
  } else {
    process.stdout.write(JSON.stringify(graph, null, 2) + '\n')
  }
}

// --- main ---

const HELP = `threadr — OSINT reconnaissance tool

usage:
  threadr scan <seed> [options]     run a scan
  threadr graph <seed> [options]    dump existing graph
  threadr plugins                   list available plugins

options:
  --format, -f  json|graphml        output format (default: json)
  --depth, -d   <n>                 expansion depth (default: 2)
  --plugins, -p <list>              comma-separated plugin IDs
  --quiet, -q                       suppress log output (stderr)

examples:
  threadr scan user@example.com
  threadr scan example.com --depth 3 --format graphml > graph.xml
  threadr scan user@example.com --plugins dns,whois,crtsh -q | jq '.nodes[]'
  threadr graph example.com --format json
`

async function main() {
  const opts = parseArgs(process.argv)

  switch (opts.command) {
    case 'scan':
      await runDirectScan(opts)
      break
    case 'graph':
      await dumpGraph(opts)
      break
    case 'plugins':
      await listPlugins()
      break
    default:
      process.stdout.write(HELP)
  }

  process.exit(0)
}

main().catch(err => {
  process.stderr.write(`fatal: ${err.message}\n`)
  process.exit(1)
})
