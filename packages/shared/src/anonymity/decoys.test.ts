import { describe, it, expect } from 'vitest'
import { generateDecoys, interleaveTargets, identificationProbability } from './decoys.js'

describe('generateDecoys', () => {
  it('generates the requested number of decoys', () => {
    const decoys = generateDecoys('example.com', 'Domain', 3)
    expect(decoys).toHaveLength(3)
  })

  it('never includes the real target', () => {
    for (let i = 0; i < 20; i++) {
      const decoys = generateDecoys('google.com', 'Domain', 5)
      expect(decoys).not.toContain('google.com')
    }
  })

  it('returns real domains from the pool', () => {
    const decoys = generateDecoys('example.com', 'Domain', 3)
    for (const d of decoys) {
      expect(d).toContain('.')
      expect(d.length).toBeGreaterThan(3)
    }
  })

  it('returns unique decoys (no duplicates)', () => {
    const decoys = generateDecoys('example.com', 'Domain', 10)
    const unique = new Set(decoys)
    expect(unique.size).toBe(decoys.length)
  })

  it('handles IP type', () => {
    const decoys = generateDecoys('1.2.3.4', 'IP', 3)
    expect(decoys).toHaveLength(3)
    for (const d of decoys) {
      expect(d).toMatch(/^\d+\.\d+/)
    }
  })

  it('handles Email type', () => {
    const decoys = generateDecoys('user@target.com', 'Email', 3)
    expect(decoys).toHaveLength(3)
    for (const d of decoys) {
      expect(d).toContain('@')
    }
  })

  it('handles Username type', () => {
    const decoys = generateDecoys('targetuser', 'Username', 3)
    expect(decoys).toHaveLength(3)
  })

  it('caps at pool size when k exceeds available', () => {
    const decoys = generateDecoys('admin', 'Username', 100)
    expect(decoys.length).toBeLessThanOrEqual(23) // pool has 24, minus 'admin'
  })

  it('returns empty for zero k', () => {
    expect(generateDecoys('example.com', 'Domain', 0)).toHaveLength(0)
  })
})

describe('interleaveTargets', () => {
  it('includes all real targets', () => {
    const targets = [
      { value: 'target1.com', key: 'name' },
      { value: 'target2.com', key: 'name' },
    ]
    const result = interleaveTargets(targets, 'Domain', 2)
    const real = result.filter(r => r.isReal)
    expect(real).toHaveLength(2)
    expect(real.map(r => r.value).sort()).toEqual(['target1.com', 'target2.com'])
  })

  it('includes decoys', () => {
    const targets = [{ value: 'target.com', key: 'name' }]
    const result = interleaveTargets(targets, 'Domain', 3)
    const decoys = result.filter(r => !r.isReal)
    expect(decoys).toHaveLength(3)
  })

  it('total items = real + decoys', () => {
    const targets = [{ value: 'target.com', key: 'name' }]
    const result = interleaveTargets(targets, 'Domain', 4)
    expect(result).toHaveLength(5) // 1 real + 4 decoys
  })

  it('output is shuffled (not real first)', () => {
    const targets = [{ value: 'target.com', key: 'name' }]
    // Run multiple times — at least once the real target shouldn't be first
    let realNotFirst = false
    for (let i = 0; i < 20; i++) {
      const result = interleaveTargets(targets, 'Domain', 5)
      if (!result[0].isReal) realNotFirst = true
    }
    expect(realNotFirst).toBe(true)
  })
})

describe('identificationProbability', () => {
  it('k=0 gives 100% identification', () => {
    expect(identificationProbability(0)).toBe(1)
  })

  it('k=1 gives 50%', () => {
    expect(identificationProbability(1)).toBeCloseTo(0.5)
  })

  it('k=3 gives 25%', () => {
    expect(identificationProbability(3)).toBeCloseTo(0.25)
  })

  it('k=9 gives 10%', () => {
    expect(identificationProbability(9)).toBeCloseTo(0.1)
  })

  it('higher k = lower probability', () => {
    for (let k = 1; k < 10; k++) {
      expect(identificationProbability(k)).toBeGreaterThan(identificationProbability(k + 1))
    }
  })
})
