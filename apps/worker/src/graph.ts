import neo4j from 'neo4j-driver'
import type { NodeType, EdgeType } from '@threadr/shared'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

let consecutiveFailures = 0
const MAX_FAILURES = 5
const BACKOFF_MS = 5_000

function isUp(): boolean {
  return consecutiveFailures < MAX_FAILURES
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log(`[*] neo4j recovered after ${consecutiveFailures} failures`)
    consecutiveFailures = 0
  }
}

function recordFailure(err: Error) {
  consecutiveFailures++
  if (consecutiveFailures === MAX_FAILURES) {
    console.log(`[!] neo4j: ${MAX_FAILURES} consecutive failures, pausing writes`)
  } else {
    console.log(`[!] neo4j (${consecutiveFailures}/${MAX_FAILURES}): ${err.message}`)
  }
}

/** Reset failure counter — call at scan start to retry after backoff */
export function resetGraphHealth() {
  if (consecutiveFailures >= MAX_FAILURES) {
    console.log(`[*] neo4j: resetting health, will retry on next write`)
  }
  consecutiveFailures = 0
}

// Cypher doesn't support parameterised labels or relationship types.
// Validate against the type system's known values to prevent injection.
const VALID_LABELS: ReadonlySet<string> = new Set<NodeType>([
  'Email', 'Username', 'Person', 'Domain', 'IP', 'Certificate',
  'Breach', 'Phone', 'Organization', 'Port', 'Repository',
])

const VALID_KEYS: ReadonlySet<string> = new Set([
  'address', 'name', 'id', 'number', 'phone',
])

const VALID_RELS: ReadonlySet<string> = new Set<EdgeType>([
  'EXPOSED_IN', 'USES', 'OWNS', 'RESOLVES_TO', 'HAS_CERT',
  'HAS_MX', 'WORKS_AT', 'COMMITTED_TO', 'OPEN_PORT', 'LINKED_TO', 'PROBABLY_IS',
])

function assertLabel(label: string): void {
  if (!VALID_LABELS.has(label)) throw new Error(`invalid label: ${label}`)
}

function assertKey(key: string): void {
  if (!VALID_KEYS.has(key)) throw new Error(`invalid key: ${key}`)
}

function assertRel(rel: string): void {
  if (!VALID_RELS.has(rel)) throw new Error(`invalid rel: ${rel}`)
}

export async function storeNode(label: string, key: string, props: Record<string, string>) {
  if (!isUp()) return
  assertLabel(label)
  assertKey(key)
  const session = driver.session()
  try {
    await session.run(
      `MERGE (n:\`${label}\` {\`${key}\`: $val}) SET n += $props RETURN n`,
      { val: props[key], props }
    )
    recordSuccess()
  } catch (e) {
    recordFailure(e as Error)
  } finally {
    await session.close()
  }
}

export async function storeEdge(
  fromLabel: string, fromKey: string, fromVal: string,
  toLabel: string, toKey: string, toVal: string,
  rel: string
) {
  if (!isUp()) return
  assertLabel(fromLabel)
  assertLabel(toLabel)
  assertKey(fromKey)
  assertKey(toKey)
  assertRel(rel)
  const session = driver.session()
  try {
    await session.run(
      `MATCH (a:\`${fromLabel}\` {\`${fromKey}\`: $fv})
       MATCH (b:\`${toLabel}\` {\`${toKey}\`: $tv})
       MERGE (a)-[:\`${rel}\`]->(b)`,
      { fv: fromVal, tv: toVal }
    )
    recordSuccess()
  } catch (e) {
    recordFailure(e as Error)
  } finally {
    await session.close()
  }
}

export async function close() {
  await driver.close()
}
