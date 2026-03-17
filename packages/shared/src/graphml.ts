interface GraphNode {
  id: string
  label: string
  props: Record<string, string>
}

interface GraphEdge {
  from: string
  to: string
  type: string
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function toGraphML(nodes: GraphNode[], edges: GraphEdge[]) {
  const propKeys = new Set<string>()
  for (const n of nodes) for (const k of Object.keys(n.props)) propKeys.add(k)

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<graphml xmlns="http://graphml.graphstruct.org/xmlns">\n'
  xml += '  <key id="label" for="node" attr.name="label" attr.type="string"/>\n'
  for (const k of propKeys) {
    xml += `  <key id="${escape(k)}" for="node" attr.name="${escape(k)}" attr.type="string"/>\n`
  }
  xml += '  <key id="type" for="edge" attr.name="type" attr.type="string"/>\n'
  xml += '  <graph id="G" edgedefault="directed">\n'

  for (const n of nodes) {
    xml += `    <node id="${escape(n.id)}">\n`
    xml += `      <data key="label">${escape(n.label)}</data>\n`
    for (const [k, v] of Object.entries(n.props)) {
      xml += `      <data key="${escape(k)}">${escape(v)}</data>\n`
    }
    xml += '    </node>\n'
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    xml += `    <edge id="e${i}" source="${escape(e.from)}" target="${escape(e.to)}">\n`
    xml += `      <data key="type">${escape(e.type)}</data>\n`
    xml += '    </edge>\n'
  }

  xml += '  </graph>\n</graphml>\n'
  return xml
}
