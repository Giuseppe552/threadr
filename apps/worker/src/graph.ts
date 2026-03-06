import neo4j from 'neo4j-driver'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

let up = true

export async function storeNode(label: string, key: string, props: Record<string, string>) {
  if (!up) return
  const session = driver.session()
  try {
    await session.run(
      `MERGE (n:${label} {${key}: $val}) SET n += $props RETURN n`,
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
  const session = driver.session()
  try {
    await session.run(
      `MATCH (a:${fromLabel} {${fromKey}: $fv})
       MATCH (b:${toLabel} {${toKey}: $tv})
       MERGE (a)-[:${rel}]->(b)`,
      { fv: fromVal, tv: toVal }
    )
  } catch (e) {
    console.log(`[!] edge write failed: ${(e as Error).message}`)
  } finally {
    await session.close()
  }
}

// get all nodes+edges for a scan's seed
export async function getGraph(seedLabel: string, seedKey: string, seedVal: string) {
  const session = driver.session()
  try {
    const res = await session.run(
      `MATCH (root:${seedLabel} {${seedKey}: $val})-[r*0..3]-(n)
       RETURN DISTINCT n, labels(n) as labels, properties(n) as props`,
      { val: seedVal }
    )
    const nodes = res.records.map((r) => ({
      id: r.get('n').elementId,
      label: r.get('labels')[0],
      props: r.get('props'),
    }))

    const edgeRes = await session.run(
      `MATCH (root:${seedLabel} {${seedKey}: $val})-[*0..2]-(a)-[r]-(b)
       RETURN DISTINCT type(r) as type, a.${seedKey} as from_key, elementId(a) as from_id, elementId(b) as to_id`,
      { val: seedVal }
    )
    const edges = edgeRes.records.map((r) => ({
      from: r.get('from_id'),
      to: r.get('to_id'),
      type: r.get('type'),
    }))

    return { nodes, edges }
  } finally {
    await session.close()
  }
}

export async function close() {
  await driver.close()
}
