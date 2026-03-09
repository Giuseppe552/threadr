import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Graph } from '../Graph.tsx'

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

interface MergeSuggestion {
  fromId: string
  fromName: string
  toId: string
  toName: string
  confidence: number
}

export function Scan() {
  const { id } = useParams()
  const [scan, setScan] = useState<ScanData | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [expanding, setExpanding] = useState(false)
  const [merges, setMerges] = useState<MergeSuggestion[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  useEffect(() => {
    if (!id) return
    fetch(`/api/scan/${id}`).then(r => r.json()).then(setScan)
    fetch(`/api/scan/${id}/graph`).then(r => r.json()).then(data => {
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
    })
    fetch(`/api/scan/${id}/merges`).then(r => r.json()).then(setMerges)
  }, [id])

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  async function expandNode(node: GraphNode) {
    if (!id) return
    const seed = node.props.address || node.props.name
    if (!seed) return
    setExpanding(true)
    await fetch(`/api/scan/${id}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    })
    // poll for updates after a sec
    setTimeout(async () => {
      const data = await fetch(`/api/scan/${id}/graph`).then(r => r.json())
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
      setExpanding(false)
    }, 3000)
  }

  if (!scan) return <div className="p-4 text-text-muted text-sm">loading...</div>

  return (
    <div className="flex flex-col h-[calc(100vh-41px)]">
      <div className="flex flex-1 min-h-0">
        <div ref={containerRef} className="flex-1 min-w-0">
          <Graph
            nodes={nodes}
            edges={edges}
            selectedId={selected?.id}
            width={dims.w}
            height={dims.h}
            onNodeClick={setSelected}
            onNodeRightClick={expandNode}
          />
        </div>

        {selected && (
          <div className="w-72 border-l border-border p-3 overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <div className="text-xs text-text-muted uppercase">{selected.label}</div>
              <button
                onClick={() => setSelected(null)}
                className="text-text-muted hover:text-text text-xs"
              >
                ×
              </button>
            </div>
            <div className="mono text-sm text-mono mb-3">
              {selected.props.address || selected.props.name || selected.id}
            </div>
            <div className="space-y-1.5">
              {Object.entries(selected.props).map(([k, v]) => (
                <div key={k} className="text-xs">
                  <span className="text-text-muted">{k}: </span>
                  <span className="mono text-mono">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => expandNode(selected)}
                disabled={expanding}
                className="text-xs px-2 py-0.5 border border-border hover:border-text-muted rounded-sm disabled:opacity-50"
              >
                {expanding ? '...' : 'expand'}
              </button>
            </div>

            {edges.filter(e => e.from === selected.id || e.to === selected.id).length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-text-muted uppercase mb-1">
                  connections ({edges.filter(e => e.from === selected.id || e.to === selected.id).length})
                </div>
                {edges
                  .filter(e => e.from === selected.id || e.to === selected.id)
                  .map((e, i) => {
                    const otherId = e.from === selected.id ? e.to : e.from
                    const other = nodes.find(n => n.id === otherId)
                    return (
                      <div
                        key={i}
                        className="text-xs py-0.5 cursor-pointer hover:text-text text-text-muted"
                        onClick={() => other && setSelected(other)}
                      >
                        {e.type} → {other?.props.address || other?.props.name || otherId}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}
      </div>

      {merges.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-surface">
          <div className="text-xs text-text-muted uppercase mb-1">merge suggestions</div>
          {merges.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-0.5">
              <span className="mono text-mono">{m.fromName}</span>
              <span className="text-text-muted">≈</span>
              <span className="mono text-mono">{m.toName}</span>
              <span className="text-text-muted">({(m.confidence * 100).toFixed(0)}%)</span>
              <button
                onClick={async () => {
                  await fetch('/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId: m.fromId, toId: m.toId, action: 'confirm' }) })
                  setMerges(merges.filter((_, j) => j !== i))
                }}
                className="text-green-500 hover:underline ml-auto"
              >confirm</button>
              <button
                onClick={async () => {
                  await fetch('/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId: m.fromId, toId: m.toId, action: 'reject' }) })
                  setMerges(merges.filter((_, j) => j !== i))
                }}
                className="text-red-500 hover:underline"
              >reject</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 px-4 py-1.5 border-t border-border text-xs text-text-muted bg-surface">
        <span>scan: <span className="mono">{scan.seed}</span></span>
        <span>{nodes.length} nodes</span>
        <span>{edges.length} edges</span>
        <span>{scan.status}</span>
      </div>
    </div>
  )
}
