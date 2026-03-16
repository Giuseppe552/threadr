import { describe, it, expect } from 'vitest'
import { analyzeSpectrum } from './spectral.js'

describe('spectral analysis', () => {
  it('handles single node', () => {
    const result = analyzeSpectrum({ nodeIds: ['a'], edges: [] })
    expect(result.communities.get('a')).toBe(0)
    expect(result.algebraicConnectivity).toBe(0)
  })

  it('detects two clear communities in a barbell graph', () => {
    // Two cliques of 3 nodes connected by a single bridge
    const nodeIds = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']
    const edges = [
      // Clique A
      { from: 'a1', to: 'a2' },
      { from: 'a2', to: 'a3' },
      { from: 'a1', to: 'a3' },
      // Clique B
      { from: 'b1', to: 'b2' },
      { from: 'b2', to: 'b3' },
      { from: 'b1', to: 'b3' },
      // Bridge
      { from: 'a3', to: 'b1' },
    ]
    const result = analyzeSpectrum({ nodeIds, edges })

    // Should find 2 communities
    const clusterA = result.communities.get('a1')!
    const clusterB = result.communities.get('b1')!
    expect(clusterA).not.toBe(clusterB)

    // All of clique A in same cluster
    expect(result.communities.get('a2')).toBe(clusterA)
    expect(result.communities.get('a3')).toBe(clusterA)

    // All of clique B in same cluster
    expect(result.communities.get('b2')).toBe(clusterB)
    expect(result.communities.get('b3')).toBe(clusterB)
  })

  it('bridge nodes have high Fiedler vector values', () => {
    const nodeIds = ['a1', 'a2', 'a3', 'bridge', 'b1', 'b2', 'b3']
    const edges = [
      { from: 'a1', to: 'a2' },
      { from: 'a2', to: 'a3' },
      { from: 'a1', to: 'a3' },
      { from: 'a3', to: 'bridge' },
      { from: 'bridge', to: 'b1' },
      { from: 'b1', to: 'b2' },
      { from: 'b2', to: 'b3' },
      { from: 'b1', to: 'b3' },
    ]
    const result = analyzeSpectrum({ nodeIds, edges })
    // The bridges list should contain at least one node (top 15% by Fiedler value)
    expect(result.bridges.length).toBeGreaterThan(0)
    // Algebraic connectivity should be low (weak connection between communities)
    expect(result.algebraicConnectivity).toBeLessThan(0.5)
  })

  it('complete graph has high algebraic connectivity', () => {
    const nodeIds = ['a', 'b', 'c', 'd', 'e']
    const edges: { from: string; to: string }[] = []
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        edges.push({ from: nodeIds[i], to: nodeIds[j] })
      }
    }
    const result = analyzeSpectrum({ nodeIds, edges })
    // Complete graph: λ₂ = n/(n-1) for normalized Laplacian
    expect(result.algebraicConnectivity).toBeGreaterThan(0.5)
  })

  it('disconnected graph has λ₂ ≈ 0', () => {
    const nodeIds = ['a', 'b', 'c', 'd']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
      // No edges between {a,b} and {c,d}
    ]
    const result = analyzeSpectrum({ nodeIds, edges })
    expect(result.algebraicConnectivity).toBeLessThan(0.01)
  })

  it('weighted edges affect community detection', () => {
    const nodeIds = ['a', 'b', 'c', 'd']
    const edges = [
      { from: 'a', to: 'b', weight: 10 },  // strong connection
      { from: 'c', to: 'd', weight: 10 },  // strong connection
      { from: 'b', to: 'c', weight: 0.1 }, // weak bridge
    ]
    const result = analyzeSpectrum({ nodeIds, edges })
    // a,b should be in one cluster; c,d in another
    expect(result.communities.get('a')).toBe(result.communities.get('b'))
    expect(result.communities.get('c')).toBe(result.communities.get('d'))
  })

  it('anomaly scores are non-negative', () => {
    const nodeIds = ['a', 'b', 'c']
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
    const result = analyzeSpectrum({ nodeIds, edges })
    for (const [, score] of result.anomalyScores) {
      expect(score).toBeGreaterThanOrEqual(0)
    }
  })

  it('eigenvalues are non-negative (Laplacian property)', () => {
    const nodeIds = ['a', 'b', 'c', 'd', 'e']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'e' },
      { from: 'a', to: 'd' },
    ]
    const result = analyzeSpectrum({ nodeIds, edges })
    for (const λ of result.eigenvalues) {
      expect(λ).toBeGreaterThanOrEqual(-0.01) // small tolerance for numerical error
    }
  })
})
