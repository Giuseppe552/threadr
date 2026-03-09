import { useRef, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const NODE_COLORS: Record<string, string> = {
  Email: '#4a9eff',
  Domain: '#22c55e',
  IP: '#f59e0b',
  Username: '#a78bfa',
  Breach: '#ef4444',
  Certificate: '#6b7280',
  Person: '#e0e0e0',
  Organization: '#14b8a6',
  Repository: '#6b7280',
  Phone: '#f59e0b',
  Port: '#6b7280',
}

interface Node {
  id: string
  label: string
  props: Record<string, string>
}

interface Edge {
  from: string
  to: string
  type: string
  confidence?: number
  auto?: boolean
}

interface Props {
  nodes: Node[]
  edges: Edge[]
  selectedId?: string
  onNodeClick?: (node: Node) => void
  onNodeRightClick?: (node: Node) => void
  width: number
  height: number
}

export function Graph({ nodes, edges, selectedId, onNodeClick, onNodeRightClick, width, height }: Props) {
  const fgRef = useRef<any>(null)

  const degree = useMemo(() => {
    const d: Record<string, number> = {}
    for (const e of edges) {
      d[e.from] = (d[e.from] || 0) + 1
      d[e.to] = (d[e.to] || 0) + 1
    }
    return d
  }, [edges])

  const graphData = {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      name: n.props.address || n.props.name || n.id,
      color: NODE_COLORS[n.label] || '#666',
      _raw: n,
      _deg: degree[n.id] || 0,
    })),
    links: edges.map(e => ({
      source: e.from,
      target: e.to,
      type: e.type,
      confidence: e.confidence,
      _isProbably: e.type === 'PROBABLY_IS',
    })),
  }

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const size = Math.max(4, Math.min(14, 3 + node._deg * 1.5))

    // selection ring
    if (selectedId && node.id === selectedId) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size + 3, 0, 2 * Math.PI)
      ctx.strokeStyle = node.color
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.35
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()

    const fontSize = Math.max(10, size)
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`
    ctx.fillStyle = '#ccc'
    ctx.textAlign = 'center'
    ctx.fillText(node.name.slice(0, 18), node.x, node.y + size + fontSize + 1)
  }, [selectedId])

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="#0a0a0a"
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
        const size = Math.max(6, Math.min(16, 5 + (node._deg || 0) * 1.5))
        ctx.beginPath()
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
      }}
      nodeLabel={(node: any) => `${node.label}: ${node.name}`}
      linkColor={(link: any) => {
        if (link._isProbably) return `rgba(168, 85, 247, ${link.confidence || 0.5})`
        if (link.type === 'EXPOSED_IN') return '#ef4444'
        if (link.type === 'OPEN_PORT') return '#f59e0b'
        return '#555'
      }}
      linkWidth={(link: any) => {
        if (link._isProbably) return (link.confidence || 0.5) * 3
        if (link.type === 'EXPOSED_IN') return 1.5
        return 0.8
      }}
      linkLineDash={(link: any) => link._isProbably ? [4, 2] : null}
      linkDirectionalArrowLength={4}
      linkDirectionalArrowRelPos={1}
      linkLabel={(link: any) => link.type}
      onNodeClick={(node: any) => onNodeClick?.(node._raw)}
      onNodeRightClick={(node: any, event: MouseEvent) => {
        event.preventDefault()
        onNodeRightClick?.(node._raw)
      }}
      cooldownTicks={100}
      d3AlphaDecay={0.02}
    />
  )
}
