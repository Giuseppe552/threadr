import { useRef, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const NODE_COLORS: Record<string, string> = {
  Email: '#4a9eff',
  Domain: '#22c55e',
  IP: '#f59e0b',
  Username: '#a78bfa',
  Breach: '#ef4444',
  Certificate: '#64748b',
  Person: '#e0e0e0',
  Organization: '#14b8a6',
  Repository: '#64748b',
  Phone: '#f59e0b',
  Port: '#64748b',
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
      color: NODE_COLORS[n.label] || '#555',
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

    // Outer glow for high-degree nodes
    if (node._deg > 3) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size + 6, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.globalAlpha = 0.06
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // Selection ring
    if (selectedId && node.id === selectedId) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI)
      ctx.strokeStyle = '#3b9eff'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Node circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()

    // Inner highlight
    ctx.beginPath()
    ctx.arc(node.x, node.y, size * 0.4, 0, 2 * Math.PI)
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fill()

    // Label
    const fontSize = Math.max(9, Math.min(11, size))
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`
    ctx.fillStyle = 'rgba(228, 232, 240, 0.7)'
    ctx.textAlign = 'center'
    ctx.fillText(node.name.slice(0, 22), node.x, node.y + size + fontSize + 2)
  }, [selectedId])

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="#080b12"
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
        if (link.type === 'EXPOSED_IN') return 'rgba(239, 68, 68, 0.7)'
        if (link.type === 'OPEN_PORT') return 'rgba(245, 158, 11, 0.6)'
        return 'rgba(94, 104, 120, 0.3)'
      }}
      linkWidth={(link: any) => {
        if (link._isProbably) return (link.confidence || 0.5) * 3
        if (link.type === 'EXPOSED_IN') return 1.5
        return 0.6
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
