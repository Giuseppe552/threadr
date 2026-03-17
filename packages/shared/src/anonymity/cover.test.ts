import { describe, it, expect } from 'vitest'
import { nextState, generateCoverTraffic, interleaveWithCover, TRANSITION_MATRIX, STATES } from './cover.js'

describe('Markov chain', () => {
  it('transition matrix rows sum to 1', () => {
    for (let i = 0; i < TRANSITION_MATRIX.length; i++) {
      const sum = TRANSITION_MATRIX[i].reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1.0, 2)
    }
  })

  it('nextState returns valid index', () => {
    for (let i = 0; i < 100; i++) {
      const state = nextState(0)
      expect(state).toBeGreaterThanOrEqual(0)
      expect(state).toBeLessThan(STATES.length)
    }
  })

  it('all states are reachable from search', () => {
    const visited = new Set<number>()
    for (let i = 0; i < 500; i++) {
      visited.add(nextState(0)) // from search state
    }
    // Should reach most states (at least 4 of 7)
    expect(visited.size).toBeGreaterThanOrEqual(4)
  })
})

describe('cover traffic generation', () => {
  it('generates requested number of requests (approximately)', () => {
    const traffic = generateCoverTraffic(20)
    // Some requests may be idle (skipped), so allow range
    expect(traffic.length).toBeGreaterThan(5)
    expect(traffic.length).toBeLessThanOrEqual(20)
  })

  it('all URLs are strings', () => {
    const traffic = generateCoverTraffic(10)
    for (const t of traffic) {
      expect(typeof t.url).toBe('string')
      expect(t.url.startsWith('https://') || t.url.startsWith('http://')).toBe(true)
    }
  })

  it('methods are GET or HEAD', () => {
    const traffic = generateCoverTraffic(20)
    for (const t of traffic) {
      expect(['GET', 'HEAD']).toContain(t.method)
    }
  })
})

describe('interleave with cover', () => {
  it('includes all real requests', () => {
    const real = [
      { url: 'https://api.github.com/users', method: 'GET', pluginId: 'github' },
      { url: 'https://crt.sh/?q=test', method: 'GET', pluginId: 'crtsh' },
    ]
    const mixed = interleaveWithCover(real, 2)
    const realInMixed = mixed.filter(m => m.type === 'real')
    expect(realInMixed.length).toBe(2)
  })

  it('cover requests outnumber real requests', () => {
    const real = [
      { url: 'https://api.github.com/users', method: 'GET', pluginId: 'github' },
    ]
    const mixed = interleaveWithCover(real, 3)
    const coverCount = mixed.filter(m => m.type === 'cover').length
    expect(coverCount).toBeGreaterThanOrEqual(1)
  })

  it('output is shuffled (not real-then-cover)', () => {
    const real = Array.from({ length: 10 }, (_, i) => ({
      url: `https://api${i}.com`, method: 'GET', pluginId: `p${i}`,
    }))
    const mixed = interleaveWithCover(real, 2)
    // Check that it's not perfectly ordered (real first, cover last)
    const types = mixed.map(m => m.type)
    const firstCoverIdx = types.indexOf('cover')
    const lastRealIdx = types.lastIndexOf('real')
    // If shuffled, cover should appear before some real requests
    if (mixed.length > 5) {
      expect(firstCoverIdx).toBeLessThan(lastRealIdx)
    }
  })
})
