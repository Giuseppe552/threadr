import { describe, it, expect } from 'vitest'
import { predictLinks } from './linkPrediction.js'

describe('link prediction', () => {
  it('predicts link between nodes with shared neighbors', () => {
    // Triangle with one missing edge: a-b, b-c, but not a-c
    const nodeIds = ['a', 'b', 'c']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]
    const result = predictLinks(nodeIds, edges)
    // Should predict a-c link
    const prediction = result.predictions.find(
      p => (p.from === 'a' && p.to === 'c') || (p.from === 'c' && p.to === 'a')
    )
    expect(prediction).toBeDefined()
    expect(prediction!.combinedScore).toBeGreaterThan(0)
  })

  it('no predictions for complete graph', () => {
    const nodeIds = ['a', 'b', 'c']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ]
    const result = predictLinks(nodeIds, edges)
    expect(result.predictions).toHaveLength(0)
  })

  it('ranks predictions by combined score', () => {
    // a-b-c-d-e chain, plus a-c shortcut
    const nodeIds = ['a', 'b', 'c', 'd', 'e']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'e' },
    ]
    const result = predictLinks(nodeIds, edges)
    // Predictions should be sorted descending
    for (let i = 1; i < result.predictions.length; i++) {
      expect(result.predictions[i].combinedScore)
        .toBeLessThanOrEqual(result.predictions[i - 1].combinedScore)
    }
  })

  it('computes Katz centrality for all nodes', () => {
    const nodeIds = ['hub', 'a', 'b', 'c']
    const edges = [
      { from: 'hub', to: 'a' },
      { from: 'hub', to: 'b' },
      { from: 'hub', to: 'c' },
    ]
    const result = predictLinks(nodeIds, edges)
    // Hub should have highest centrality
    const hubCentrality = result.katzCentrality.get('hub')!
    const leafCentrality = result.katzCentrality.get('a')!
    expect(hubCentrality).toBeGreaterThan(leafCentrality)
  })

  it('handles empty graph', () => {
    const result = predictLinks([], [])
    expect(result.predictions).toHaveLength(0)
  })

  it('Jaccard coefficient is present in predictions', () => {
    const nodeIds = ['a', 'b', 'c', 'd']
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ]
    const result = predictLinks(nodeIds, edges)
    for (const p of result.predictions) {
      expect(p.jaccardCoeff).toBeGreaterThanOrEqual(0)
      expect(p.jaccardCoeff).toBeLessThanOrEqual(1)
    }
  })
})
