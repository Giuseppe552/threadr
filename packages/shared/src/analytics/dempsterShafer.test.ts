import { describe, it, expect } from 'vitest'
import { createMass, combine, fuseAll, FIELD_RELIABILITY } from './dempsterShafer.js'

describe('createMass', () => {
  it('perfect match with high reliability → strong SAME evidence', () => {
    const m = createMass(1.0, 0.92, 'email')
    expect(m.same).toBeCloseTo(0.92)
    expect(m.different).toBeCloseTo(0)
    expect(m.uncertain).toBeCloseTo(0.08)
  })

  it('zero match with high reliability → strong DIFFERENT evidence', () => {
    const m = createMass(0.0, 0.92, 'email')
    expect(m.same).toBeCloseTo(0)
    expect(m.different).toBeCloseTo(0.92)
    expect(m.uncertain).toBeCloseTo(0.08)
  })

  it('partial match → split between SAME and DIFFERENT', () => {
    const m = createMass(0.5, 0.80, 'username')
    expect(m.same).toBeCloseTo(0.40)
    expect(m.different).toBeCloseTo(0.40)
    expect(m.uncertain).toBeCloseTo(0.20)
  })

  it('low reliability → mostly uncertain', () => {
    const m = createMass(1.0, 0.35, 'name')
    expect(m.same).toBeCloseTo(0.35)
    expect(m.uncertain).toBeCloseTo(0.65)
  })

  it('mass function sums to 1', () => {
    const m = createMass(0.73, 0.65, 'username')
    expect(m.same + m.different + m.uncertain).toBeCloseTo(1.0)
  })
})

describe('combine', () => {
  it('two agreeing sources reinforce each other', () => {
    const m1 = createMass(0.9, 0.92, 'email')
    const m2 = createMass(0.85, 0.65, 'username')
    const fused = combine(m1, m2)
    // Combined SAME belief should be higher than either source alone
    expect(fused.same).toBeGreaterThan(m1.same)
    expect(fused.same).toBeGreaterThan(m2.same)
  })

  it('conflicting sources reduce confidence', () => {
    const m1 = createMass(0.95, 0.92, 'email')     // strong SAME
    const m2 = createMass(0.05, 0.65, 'username')   // strong DIFFERENT
    const fused = combine(m1, m2)
    // Should still lean SAME because email is more reliable
    expect(fused.same).toBeGreaterThan(fused.different)
    // But less confident than email alone
    expect(fused.same).toBeLessThan(m1.same + 0.05)
  })

  it('combining with pure uncertainty leaves unchanged', () => {
    const m1 = createMass(0.8, 0.92, 'email')
    const vacuous = { same: 0, different: 0, uncertain: 1, source: 'vacuous' }
    const fused = combine(m1, vacuous)
    expect(fused.same).toBeCloseTo(m1.same)
    expect(fused.different).toBeCloseTo(m1.different)
  })

  it('result sums to 1', () => {
    const m1 = createMass(0.7, 0.8, 'a')
    const m2 = createMass(0.3, 0.6, 'b')
    const fused = combine(m1, m2)
    expect(fused.same + fused.different + fused.uncertain).toBeCloseTo(1.0)
  })

  it('total conflict returns max uncertainty', () => {
    const m1 = { same: 1, different: 0, uncertain: 0, source: 'a' }
    const m2 = { same: 0, different: 1, uncertain: 0, source: 'b' }
    const fused = combine(m1, m2)
    expect(fused.uncertain).toBe(1)
  })
})

describe('fuseAll', () => {
  it('empty input → pure uncertainty', () => {
    const result = fuseAll([])
    expect(result.belief).toBe(0)
    expect(result.plausibility).toBe(1)
    expect(result.uncertainty).toBe(1)
  })

  it('single source → belief equals mass', () => {
    const m = createMass(0.9, 0.92, 'email')
    const result = fuseAll([m])
    expect(result.belief).toBeCloseTo(m.same)
  })

  it('three agreeing sources → very high belief', () => {
    const masses = [
      createMass(0.95, FIELD_RELIABILITY.email, 'email'),
      createMass(0.88, FIELD_RELIABILITY.username, 'username'),
      createMass(0.90, FIELD_RELIABILITY.avatar, 'avatar'),
    ]
    const result = fuseAll(masses)
    expect(result.belief).toBeGreaterThan(0.95)
    expect(result.uncertainty).toBeLessThan(0.05)
  })

  it('belief ≤ plausibility always', () => {
    const masses = [
      createMass(0.6, 0.7, 'a'),
      createMass(0.4, 0.5, 'b'),
      createMass(0.8, 0.3, 'c'),
    ]
    const result = fuseAll(masses)
    expect(result.belief).toBeLessThanOrEqual(result.plausibility)
  })

  it('tracks conflict level', () => {
    const masses = [
      createMass(0.95, 0.92, 'email'),   // strong SAME
      createMass(0.05, 0.65, 'username'), // strong DIFFERENT
    ]
    const result = fuseAll(masses)
    expect(result.conflict).toBeGreaterThan(0.1) // significant conflict
  })

  it('tracks all sources', () => {
    const masses = [
      createMass(0.9, 0.9, 'email'),
      createMass(0.8, 0.7, 'username'),
      createMass(0.7, 0.5, 'name'),
    ]
    const result = fuseAll(masses)
    expect(result.sources).toEqual(['email', 'username', 'name'])
  })
})
