import neo4j from 'neo4j-driver'
import type { NodeType, EdgeType } from '@threadr/shared'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

let up = true

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
  if (!up) return
  assertLabel(label)
  assertKey(key)
  const session = driver.session()
  try {
    await session.run(
      `MERGE (n:\`${label}\` {\`${key}\`: $val}) SET n += $props RETURN n`,
      { val: props[key], props }
    )
  } catch (e) {
    console.log(`[!] neo4j down: ${(e as Error).message}`)
    up = false
  } finally {
    await session.close()
  }
}

export async function storeEdge(
  fromLabel: string, fromKey: string, fromVal: string,
  toLabel: string, toKey: string, toVal: string,
  rel: string
) {
  if (!up) return
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
  } catch (e) {
    console.log(`[!] edge write failed: ${(e as Error).message}`)
  } finally {
    await session.close()
  }
}

export async function close() {
  await driver.close()
}
