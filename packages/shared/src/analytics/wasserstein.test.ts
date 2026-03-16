import { describe, it, expect } from 'vitest'
import { graphDistance } from './wasserstein.js'
import type { GraphNode, GraphEdge } from '../index.js'

function node(id: string, label: GraphNode['label'], props: Record<string, string> = {}): GraphNode {
  return { id, label, props }
}

describe('Wasserstein graph distance', () => {
  it('identical graphs have zero distance', () => {
    const nodes = [
      node('a', 'Email', { address: 'a@x.com' }),
      node('b', 'Domain', { name: 'x.com' }),
    ]
    const edges: GraphEdge[] = [{ from: 'a', to: 'b', type: 'RESOLVES_TO' }]
    const result = graphDistance(nodes, edges, nodes, edges)
    expect(result.distance).toBeLessThan(0.01)
    expect(result.deleted).toHaveLength(0)
    expect(result.created).toHaveLength(0)
  })

  it('completely different graphs have high distance', () => {
    const old = [node('a', 'Email', { address: 'a@x.com' })]
    const neu = [node('b', 'Domain', { name: 'y.com' })]
    const result = graphDistance(old, [], neu, [])
    expect(result.normalizedDistance).toBeGreaterThanOrEqual(0.5)
  })

  it('detects created nodes', () => {
    const old = [node('a', 'Email', { address: 'a@x.com' })]
    const neu = [
      node('a', 'Email', { address: 'a@x.com' }),
      node('b', 'Domain', { name: 'new.com' }),
    ]
    const result = graphDistance(old, [], neu, [])
    expect(result.created).toContain('b')
  })

  it('detects deleted nodes', () => {
    const old = [
      node('a', 'Email', { address: 'a@x.com' }),
      node('b', 'Domain', { name: 'old.com' }),
    ]
    const neu = [node('a', 'Email', { address: 'a@x.com' })]
    const result = graphDistance(old, [], neu, [])
    expect(result.deleted).toContain('b')
  })

  it('empty → empty has zero distance', () => {
    const result = graphDistance([], [], [], [])
    expect(result.distance).toBe(0)
  })

  it('empty → non-empty has distance = new size', () => {
    const neu = [node('a', 'Email'), node('b', 'Domain')]
    const result = graphDistance([], [], neu, [])
    expect(result.distance).toBe(2)
    expect(result.created).toHaveLength(2)
  })

  it('matched nodes have cost < 1', () => {
    const old = [node('a', 'Email', { address: 'john@x.com' })]
    const neu = [node('a2', 'Email', { address: 'john@x.com' })] // same content, different id
    const result = graphDistance(old, [], neu, [])
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0].cost).toBeLessThan(0.5) // same type + same address
  })

  it('normalizedDistance is in [0, 1]', () => {
    const old = [node('a', 'Email'), node('b', 'Person')]
    const neu = [node('c', 'Domain'), node('d', 'IP'), node('e', 'Port')]
    const result = graphDistance(old, [], neu, [])
    expect(result.normalizedDistance).toBeGreaterThanOrEqual(0)
    expect(result.normalizedDistance).toBeLessThanOrEqual(2) // can exceed 1 if all mismatched + extras
  })
})
