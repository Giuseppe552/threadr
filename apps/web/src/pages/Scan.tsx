import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

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

interface ScanData {
  id: string
  seed: string
  seed_type: string
  status: string
  node_count: number
  edge_count: number
}

export function Scan() {
  const { id } = useParams()
  const [scan, setScan] = useState<ScanData | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])

  useEffect(() => {
    if (!id) return
    fetch(`/api/scan/${id}`).then(r => r.json()).then(setScan)
    fetch(`/api/scan/${id}/graph`).then(r => r.json()).then(data => {
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
    })
  }, [id])

  if (!scan) return <div className="p-4 text-text-muted text-sm">loading...</div>

  return (
    <div className="p-4">
      <div className="mb-4 text-xs text-text-muted border-b border-border pb-2 flex gap-4">
        <span>scan: <span className="mono text-mono">{scan.seed}</span></span>
        <span>{scan.status}</span>
        <span>{nodes.length} nodes</span>
        <span>{edges.length} edges</span>
      </div>

      <div className="text-xs text-text-muted uppercase tracking-wider mb-2">nodes</div>
      <div className="space-y-1">
        {nodes.map(n => (
          <div key={n.id} className="text-sm flex gap-2">
            <span className="text-text-muted w-20">{n.label}</span>
            <span className="mono text-mono">
              {n.props.address || n.props.name || n.props.url || JSON.stringify(n.props)}
            </span>
          </div>
        ))}
      </div>

      {edges.length > 0 && (
        <>
          <div className="text-xs text-text-muted uppercase tracking-wider mb-2 mt-4">edges</div>
          <div className="space-y-1">
            {edges.map((e, i) => (
              <div key={i} className="text-sm mono text-text-muted">
                {e.type}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
