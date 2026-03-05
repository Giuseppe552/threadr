import neo4j from 'neo4j-driver'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

export async function getGraph(seedVal: string) {
  const session = driver.session()
  try {
    // grab everything within 3 hops of the seed
    const res = await session.run(
      `MATCH path = (root {address: $val})-[*0..3]-()
       WITH nodes(path) AS ns, relationships(path) AS rs
       UNWIND ns AS n
       WITH COLLECT(DISTINCT n) AS nodes, rs
       UNWIND rs AS r
       WITH nodes, COLLECT(DISTINCT r) AS rels
       RETURN nodes, rels`,
      { val: seedVal }
    )

    if (res.records.length === 0) {
      // try by name instead of address
      const res2 = await session.run(
        `MATCH path = (root {name: $val})-[*0..3]-()
         WITH nodes(path) AS ns, relationships(path) AS rs
         UNWIND ns AS n
         WITH COLLECT(DISTINCT n) AS nodes, rs
         UNWIND rs AS r
         WITH nodes, COLLECT(DISTINCT r) AS rels
         RETURN nodes, rels`,
        { val: seedVal }
      )
      return parseGraphResult(res2)
    }

    return parseGraphResult(res)
  } finally {
    await session.close()
  }
}

function parseGraphResult(res: neo4j.QueryResult) {
  if (res.records.length === 0) return { nodes: [], edges: [] }

  const record = res.records[0]
  const rawNodes = record.get('nodes')
  const rawRels = record.get('rels')

  const nodes = rawNodes.map((n: neo4j.Node) => ({
    id: n.elementId,
    label: n.labels[0],
    props: n.properties,
  }))

  const edges = rawRels.map((r: neo4j.Relationship) => ({
    from: r.startNodeElementId,
    to: r.endNodeElementId,
    type: r.type,
  }))

  return { nodes, edges }
}
