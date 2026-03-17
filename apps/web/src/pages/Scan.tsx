import { useState, useEffect, useRef, useCallback } from 'react'
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

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-gray-700 text-gray-300',
  running: 'bg-amber-900 text-amber-300 animate-pulse',
  done: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
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

  function fetchGraph() {
    if (!id) return
    fetch(`/api/scan/${id}/graph`)
      .then(r => r.json())
      .then(data => { setNodes(data.nodes || []); setEdges(data.edges || []) })
      .catch(() => {})
  }

  useEffect(() => {
    if (!id) return
    fetch(`/api/scan/${id}`).then(r => r.json()).then(setScan).catch(() => {})
    fetchGraph()
    fetch(`/api/scan/${id}/merges`).then(r => r.json()).then(setMerges).catch(() => {})
  }, [id])

  // poll scan status while running
  useEffect(() => {
    if (!id || !scan) return
    if (scan.status === 'done' || scan.status === 'failed') return

    const iv = setInterval(() => {
      fetch(`/api/scan/${id}`)
        .then(r => r.json())
        .then((s: ScanData) => {
          setScan(s)
          if (s.status === 'done' || s.status === 'failed') {
            fetchGraph()
            fetch(`/api/scan/${id}/merges`).then(r => r.json()).then(setMerges).catch(() => {})
          }
        })
        .catch(() => {})
    }, 2000)

    return () => clearInterval(iv)
  }, [id, scan?.status])

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
    }).catch(() => {})

    const prevCount = nodes.length
    let tries = 0
    const poll = setInterval(async () => {
      tries++
      try {
        const data = await fetch(`/api/scan/${id}/graph`).then(r => r.json())
        if ((data.nodes || []).length > prevCount || tries >= 5) {
          setNodes(data.nodes || [])
          setEdges(data.edges || [])
          setExpanding(false)
          clearInterval(poll)
        }
      } catch {
        if (tries >= 5) { setExpanding(false); clearInterval(poll) }
      }
    }, 1500)
  }

  if (!scan) return <div className="p-4 text-text-muted text-sm">loading graph...</div>

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
          <div className="w-80 border-l border-border p-3 overflow-y-auto">
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

            {/* Properties with click-to-copy */}
            <div className="space-y-1">
              {Object.entries(selected.props).map(([k, v]) => (
                <CopyableField key={k} label={k} value={v} />
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
              <button
                onClick={() => {
                  const json = JSON.stringify(selected, null, 2)
                  navigator.clipboard.writeText(json)
                }}
                className="text-xs px-2 py-0.5 border border-border hover:border-text-muted rounded-sm"
              >
                copy node
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

      <div className="flex gap-4 px-4 py-2 border-t border-border text-xs text-text-muted bg-surface items-center">
        <span>scan: <span className="mono">{scan.seed}</span></span>
        <span>{nodes.length} nodes</span>
        <span>{edges.length} edges</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_STYLE[scan.status] || ''}`}>{scan.status}</span>
        <span className="ml-auto flex gap-2 items-center">
          <button
            onClick={async () => {
              const res = await fetch(`/api/scan/${id}/export?format=json`)
              const text = await res.text()
              await navigator.clipboard.writeText(text)
            }}
            className="px-2 py-0.5 border border-border hover:border-text-muted rounded-sm hover:text-text"
          >
            copy json
          </button>
          <a
            href={`/api/scan/${id}/export?format=json`}
            download={`threadr-${id?.slice(0, 8)}.json`}
            className="px-2 py-0.5 border border-border hover:border-text-muted rounded-sm hover:text-text inline-block"
          >
            download json
          </a>
          <a
            href={`/api/scan/${id}/export?format=graphml`}
            download={`threadr-${id?.slice(0, 8)}.graphml`}
            className="px-2 py-0.5 border border-border hover:border-text-muted rounded-sm hover:text-text inline-block"
          >
            download graphml
          </a>
        </span>
      </div>
    </div>
  )
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div
      className="flex items-start gap-1 text-xs group cursor-pointer rounded px-1 -mx-1 hover:bg-border/30"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title="click to copy"
    >
      <span className="text-text-muted shrink-0">{label}:</span>
      <span className="mono text-mono break-all flex-1">{value}</span>
      <span className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0 text-[10px]">
        {copied ? '✓' : 'copy'}
      </span>
    </div>
  )
}
