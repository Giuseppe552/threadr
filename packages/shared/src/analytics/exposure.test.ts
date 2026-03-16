import { describe, it, expect } from 'vitest'
import { computeExposure } from './exposure.js'
import type { GraphNode, GraphEdge } from '../index.js'

function node(id: string, label: GraphNode['label'], props: Record<string, string> = {}): GraphNode {
  return { id, label, props }
}

describe('exposure scoring', () => {
  it('isolated person has zero exposure', () => {
    const nodes = [node('p1', 'Person', { name: 'John' })]
    const scores = computeExposure(nodes, [])
    expect(scores).toHaveLength(1)
    expect(scores[0].totalBits).toBe(0)
    expect(scores[0].riskLevel).toBe('low')
  })

  it('person with breach has higher exposure', () => {
    const nodes = [
      node('p1', 'Person', { name: 'John' }),
      node('e1', 'Email', { address: 'john@example.com' }),
      node('b1', 'Breach', { name: 'BigBreach', data_classes: 'emails,passwords,names' }),
    ]
    const edges: GraphEdge[] = [
      { from: 'p1', to: 'e1', type: 'LINKED_TO' },
      { from: 'e1', to: 'b1', type: 'EXPOSED_IN' },
    ]
    const scores = computeExposure(nodes, edges)
    expect(scores[0].totalBits).toBeGreaterThan(0)
    expect(scores[0].breakdown.breachImpact).toBeGreaterThan(0)
  })

  it('more connected person has higher exposure', () => {
    const nodes = [
      node('p1', 'Person', { name: 'Minimal' }),
      node('e1', 'Email', { address: 'min@example.com' }),
      node('p2', 'Person', { name: 'Exposed' }),
      node('e2', 'Email', { address: 'exp@example.com' }),
      node('u1', 'Username', { name: 'exposed_user' }),
      node('d1', 'Domain', { name: 'exposed.com' }),
      node('ip1', 'IP', { address: '1.2.3.4' }),
      node('port1', 'Port', { name: '1.2.3.4:22' }),
    ]
    const edges: GraphEdge[] = [
      { from: 'p1', to: 'e1', type: 'LINKED_TO' },
      { from: 'p2', to: 'e2', type: 'LINKED_TO' },
      { from: 'p2', to: 'u1', type: 'LINKED_TO' },
      { from: 'p2', to: 'd1', type: 'OWNS' },
      { from: 'd1', to: 'ip1', type: 'RESOLVES_TO' },
      { from: 'ip1', to: 'port1', type: 'OPEN_PORT' },
    ]
    const scores = computeExposure(nodes, edges)
    const minimal = scores.find(s => s.nodeId === 'p1')!
    const exposed = scores.find(s => s.nodeId === 'p2')!
    expect(exposed.totalBits).toBeGreaterThan(minimal.totalBits)
  })

  it('risk level escalates with exposure', () => {
    const nodes = [
      node('p1', 'Person', { name: 'VeryExposed' }),
      ...Array.from({ length: 10 }, (_, i) => node(`e${i}`, 'Email', { address: `e${i}@x.com` })),
      ...Array.from({ length: 5 }, (_, i) => node(`b${i}`, 'Breach', { name: `Breach${i}`, data_classes: 'emails,passwords,names,phone,address' })),
      ...Array.from({ length: 5 }, (_, i) => node(`d${i}`, 'Domain', { name: `domain${i}.com` })),
      ...Array.from({ length: 5 }, (_, i) => node(`ip${i}`, 'IP', { address: `10.0.0.${i}` })),
    ]
    const edges: GraphEdge[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ from: 'p1', to: `e${i}`, type: 'LINKED_TO' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ from: `e${i}`, to: `b${i}`, type: 'EXPOSED_IN' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ from: 'p1', to: `d${i}`, type: 'OWNS' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ from: `d${i}`, to: `ip${i}`, type: 'RESOLVES_TO' as const })),
    ]
    const scores = computeExposure(nodes, edges)
    expect(scores[0].riskLevel).toBe('critical')
  })

  it('only scores Person nodes', () => {
    const nodes = [
      node('d1', 'Domain', { name: 'example.com' }),
      node('ip1', 'IP', { address: '1.2.3.4' }),
    ]
    const edges: GraphEdge[] = [
      { from: 'd1', to: 'ip1', type: 'RESOLVES_TO' },
    ]
    const scores = computeExposure(nodes, edges)
    expect(scores).toHaveLength(0)
  })
})
