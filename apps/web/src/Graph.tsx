import { useRef, useCallback } from 'react'
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
  onNodeClick?: (node: Node) => void
  onNodeRightClick?: (node: Node) => void
  width: number
  height: number
}

export function Graph({ nodes, edges, onNodeClick, onNodeRightClick, width, height }: Props) {
  const fgRef = useRef<any>(null)

  const graphData = {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      name: n.props.address || n.props.name || n.id,
      color: NODE_COLORS[n.label] || '#666',
      _raw: n,
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
    const size = 4
    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()

    // label
    ctx.font = '3px sans-serif'
    ctx.fillStyle = '#999'
    ctx.textAlign = 'center'
    ctx.fillText(node.name.slice(0, 24), node.x, node.y + size + 4)
  }, [])

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="#0a0a0a"
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.beginPath()
        ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
      }}
      linkColor={(link: any) => link._isProbably ? `rgba(168, 85, 247, ${link.confidence || 0.5})` : '#333'}
      linkWidth={(link: any) => link._isProbably ? (link.confidence || 0.5) * 3 : 0.5}
      linkLineDash={(link: any) => link._isProbably ? [4, 2] : null}
      linkDirectionalArrowLength={3}
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
