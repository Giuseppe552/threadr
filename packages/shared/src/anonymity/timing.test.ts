import { describe, it, expect } from 'vitest'
import { levySample, laplaceMechanism, timingEntropy } from './timing.js'

describe('Lévy stable distribution', () => {
  it('produces positive values', () => {
    for (let i = 0; i < 100; i++) {
      expect(levySample(1500)).toBeGreaterThanOrEqual(100)
    }
  })

  it('respects upper bound', () => {
    for (let i = 0; i < 100; i++) {
      expect(levySample(1500, 100, 30000)).toBeLessThanOrEqual(30000)
    }
  })

  it('has heavy tail (some values much larger than scale)', () => {
    const samples = Array.from({ length: 1000 }, () => levySample(1000))
    const max = Math.max(...samples)
    // With α=1.5, we should see values well above the scale
    expect(max).toBeGreaterThan(2000)
  })

  it('produces different values (not degenerate)', () => {
    const samples = new Set(Array.from({ length: 50 }, () => Math.round(levySample(1500))))
    expect(samples.size).toBeGreaterThan(20)
  })
})

describe('Laplace mechanism', () => {
  it('adds noise around the base value', () => {
    const base = 1000
    const samples = Array.from({ length: 100 }, () => laplaceMechanism(base, 1.0, 5000))
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    // Mean should be in the right ballpark (Laplace has mean 0, but
    // the floor at 50ms creates positive skew with large scale values)
    expect(mean).toBeGreaterThan(0)
    expect(mean).toBeLessThan(base * 10)
  })

  it('never goes below 50ms', () => {
    for (let i = 0; i < 100; i++) {
      expect(laplaceMechanism(100, 0.1, 5000)).toBeGreaterThanOrEqual(50)
    }
  })

  it('lower epsilon = more noise', () => {
    const highEps = Array.from({ length: 500 }, () => laplaceMechanism(1000, 10.0, 5000))
    const lowEps = Array.from({ length: 500 }, () => laplaceMechanism(1000, 0.1, 5000))

    const stdHigh = std(highEps)
    const stdLow = std(lowEps)

    // Lower epsilon should produce higher variance
    expect(stdLow).toBeGreaterThan(stdHigh)
  })
})

describe('timing entropy', () => {
  it('constant intervals have zero entropy', () => {
    const intervals = new Array(100).fill(1000)
    expect(timingEntropy(intervals, 500)).toBe(0)
  })

  it('varied intervals have positive entropy', () => {
    const intervals = Array.from({ length: 100 }, () => Math.random() * 10000)
    expect(timingEntropy(intervals, 500)).toBeGreaterThan(0)
  })

  it('more varied = higher entropy', () => {
    const narrow = Array.from({ length: 100 }, () => 1000 + Math.random() * 100)
    const wide = Array.from({ length: 100 }, () => Math.random() * 20000)
    expect(timingEntropy(wide, 500)).toBeGreaterThan(timingEntropy(narrow, 500))
  })
})

function std(arr: number[]): number {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}
