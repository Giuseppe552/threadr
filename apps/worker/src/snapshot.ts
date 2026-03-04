import neo4j from 'neo4j-driver'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

export interface Snapshot {
  nodes: Map<string, { label: string; props: Record<string, any> }>
  edges: Set<string>
}

export async function takeSnapshot(seedVal: string): Promise<Snapshot> {
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

    const snap: Snapshot = { nodes: new Map(), edges: new Set() }

    if (res.records.length === 0) return snap

    const record = res.records[0]
    for (const n of record.get('nodes') as neo4j.Node[]) {
      snap.nodes.set(n.elementId, {
        label: n.labels[0],
        props: { ...n.properties },
      })
    }
    for (const r of record.get('rels') as neo4j.Relationship[]) {
      snap.edges.add(`${r.startNodeElementId}-${r.type}->${r.endNodeElementId}`)
    }

    return snap
  } finally {
    await session.close()
  }
}

export interface SnapshotDiff {
  newNodes: { id: string; label: string; props: Record<string, any> }[]
  newEdges: string[]
  changedProps: { id: string; label: string; field: string; before: any; after: any }[]
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const diff: SnapshotDiff = { newNodes: [], newEdges: [], changedProps: [] }

  // new nodes
  for (const [id, data] of after.nodes) {
    if (!before.nodes.has(id)) {
      diff.newNodes.push({ id, ...data })
    } else {
      // check prop changes on existing nodes
      const oldProps = before.nodes.get(id)!.props
      for (const [k, v] of Object.entries(data.props)) {
        if (oldProps[k] !== v) {
          diff.changedProps.push({ id, label: data.label, field: k, before: oldProps[k], after: v })
        }
      }
    }
  }

  // new edges
  for (const edge of after.edges) {
    if (!before.edges.has(edge)) {
      diff.newEdges.push(edge)
    }
  }

  return diff
}
