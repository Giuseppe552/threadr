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

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-49px)]">
        <div className="text-center">
          <div className="inline-block w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
          <div className="section-label">loading scan</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-49px)]">
      <div className="flex flex-1 min-h-0">
        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 min-w-0 relative">
          <Graph
            nodes={nodes}
            edges={edges}
            selectedId={selected?.id}
            width={dims.w}
            height={dims.h}
            onNodeClick={setSelected}
            onNodeRightClick={expandNode}
          />

          {/* Node count overlay */}
          {nodes.length > 0 && (
            <div className="absolute top-3 left-3 section-label bg-bg/80 backdrop-blur-sm px-2 py-1 rounded border border-border">
              {nodes.length} nodes / {edges.length} edges
            </div>
          )}
        </div>

        {/* Detail sidebar */}
        {selected && (
          <div className="w-80 border-l border-border bg-bg-subtle/50 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div className="section-label-accent">{selected.label}</div>
              <button
                onClick={() => setSelected(null)}
                className="text-text-muted hover:text-text text-sm leading-none"
              >
                ×
              </button>
            </div>

            <div className="mono text-sm text-text mb-4 break-all">
              {selected.props.address || selected.props.name || selected.id}
            </div>

            {/* Properties */}
            <div className="space-y-0.5 mb-4">
              {Object.entries(selected.props).map(([k, v]) => (
                <CopyableField key={k} label={k} value={v} />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => expandNode(selected)}
                disabled={expanding}
                className="btn text-[10px]"
              >
                {expanding ? (
                  <span className="inline-block w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin" />
                ) : 'expand'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selected, null, 2))
                }}
                className="btn text-[10px]"
              >
                copy json
              </button>
            </div>

            {/* Connections */}
            {edges.filter(e => e.from === selected.id || e.to === selected.id).length > 0 && (
              <div>
                <div className="section-label mb-2">
                  connections ({edges.filter(e => e.from === selected.id || e.to === selected.id).length})
                </div>
                <div className="space-y-0.5">
                  {edges
                    .filter(e => e.from === selected.id || e.to === selected.id)
                    .map((e, i) => {
                      const otherId = e.from === selected.id ? e.to : e.from
                      const other = nodes.find(n => n.id === otherId)
                      return (
                        <div
                          key={i}
                          className="text-xs py-1 px-2 -mx-2 rounded cursor-pointer hover:bg-surface text-text-muted hover:text-text-secondary transition-colors mono"
                          onClick={() => other && setSelected(other)}
                        >
                          <span className="text-accent/60">{e.type}</span>
                          <span className="text-text-muted mx-1">→</span>
                          <span>{other?.props.address || other?.props.name || otherId}</span>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Merge suggestions */}
      {merges.length > 0 && (
        <div className="px-5 py-3 border-t border-border bg-bg-subtle/50">
          <div className="section-label mb-2">merge suggestions</div>
          <div className="space-y-1">
            {merges.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="mono text-mono">{m.fromName}</span>
                <span className="text-accent/40">≈</span>
                <span className="mono text-mono">{m.toName}</span>
                <span className="section-label ml-1">{(m.confidence * 100).toFixed(0)}%</span>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={async () => {
                      await fetch('/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId: m.fromId, toId: m.toId, action: 'confirm' }) })
                      setMerges(merges.filter((_, j) => j !== i))
                    }}
                    className="btn text-[10px] py-0.5 px-2 !text-accent-2 !border-accent-2/20"
                  >confirm</button>
                  <button
                    onClick={async () => {
                      await fetch('/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId: m.fromId, toId: m.toId, action: 'reject' }) })
                      setMerges(merges.filter((_, j) => j !== i))
                    }}
                    className="btn text-[10px] py-0.5 px-2 !text-critical !border-critical/20"
                  >reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex gap-4 px-5 py-2.5 border-t border-border bg-bg-subtle/80 backdrop-blur-sm text-xs items-center">
        <div className="flex items-center gap-2">
          <StatusDot status={scan.status} />
          <span className="mono text-mono">{scan.seed}</span>
        </div>

        <div className="flex gap-3 mono text-text-muted">
          <span>{nodes.length} <span className="text-text-muted/50">nodes</span></span>
          <span>{edges.length} <span className="text-text-muted/50">edges</span></span>
        </div>

        <div className="ml-auto flex gap-1.5">
          <button
            onClick={async () => {
              const res = await fetch(`/api/scan/${id}/export?format=json`)
              const text = await res.text()
              await navigator.clipboard.writeText(text)
            }}
            className="btn text-[10px] py-1"
          >
            copy
          </button>
          <a
            href={`/api/scan/${id}/export?format=json`}
            download={`threadr-${id?.slice(0, 8)}.json`}
            className="btn text-[10px] py-1 inline-flex"
          >
            json
          </a>
          <a
            href={`/api/scan/${id}/export?format=graphml`}
            download={`threadr-${id?.slice(0, 8)}.graphml`}
            className="btn text-[10px] py-1 inline-flex"
          >
            graphml
          </a>
        </div>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = {
    queued: '',
    running: 'status-dot-active',
    done: 'status-dot-active',
    failed: 'status-dot-critical',
  }
  return <div className={`status-dot ${cls[status] || ''}`} style={!cls[status] ? { background: 'var(--color-text-muted)' } : {}} />
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div
      className="flex items-start gap-1.5 text-xs group cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-surface transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title="click to copy"
    >
      <span className="text-text-muted shrink-0 section-label !text-[10px]">{label}</span>
      <span className="mono text-mono break-all flex-1 text-[11px]">{value}</span>
      <span className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0 mono text-[10px] transition-opacity">
        {copied ? '✓' : 'copy'}
      </span>
    </div>
  )
}
