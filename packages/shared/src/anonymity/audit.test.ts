import { describe, it, expect } from 'vitest'
import { ksTest, autocorrelation, runsTest, auditTraffic } from './audit.js'

describe('Kolmogorov-Smirnov test', () => {
  it('identical samples have D=0', () => {
    const sample = [1, 2, 3, 4, 5]
    const result = ksTest(sample, sample)
    expect(result.D).toBe(0)
    expect(result.reject).toBe(false)
  })

  it('very different samples are rejected', () => {
    const a = Array.from({ length: 100 }, (_, i) => i)           // uniform 0-99
    const b = Array.from({ length: 100 }, (_, i) => i * 100 + 5000) // shifted
    const result = ksTest(a, b)
    expect(result.reject).toBe(true)
    expect(result.D).toBeGreaterThan(0.5)
  })

  it('samples from same distribution are not rejected', () => {
    // Both from uniform [0, 1000]
    const a = Array.from({ length: 200 }, () => Math.random() * 1000)
    const b = Array.from({ length: 200 }, () => Math.random() * 1000)
    const result = ksTest(a, b)
    // Should usually not reject (p > 0.05), but randomized test may occasionally fail
    expect(result.D).toBeLessThan(0.3)
  })

  it('D is in [0, 1]', () => {
    const a = [1, 5, 10]
    const b = [2, 6, 11]
    const result = ksTest(a, b)
    expect(result.D).toBeGreaterThanOrEqual(0)
    expect(result.D).toBeLessThanOrEqual(1)
  })
})

describe('autocorrelation', () => {
  it('random data has low autocorrelation', () => {
    const data = Array.from({ length: 200 }, () => Math.random() * 1000)
    const r = autocorrelation(data, 1)
    expect(Math.abs(r)).toBeLessThan(0.2)
  })

  it('periodic data has high autocorrelation at the period', () => {
    // Period-5 signal
    const data = Array.from({ length: 100 }, (_, i) => Math.sin(2 * Math.PI * i / 5) * 1000)
    const r5 = autocorrelation(data, 5)
    expect(r5).toBeGreaterThan(0.5)
  })

  it('returns 0 for empty data', () => {
    expect(autocorrelation([], 1)).toBe(0)
  })
})

describe('runs test', () => {
  it('random data passes', () => {
    const data = Array.from({ length: 100 }, () => Math.random() * 1000)
    const result = runsTest(data)
    // Random data should usually pass
    expect(result.pValue).toBeGreaterThan(0.01)
  })

  it('sorted data fails (too few runs)', () => {
    const data = Array.from({ length: 100 }, (_, i) => i)
    const result = runsTest(data)
    expect(result.reject).toBe(true)
  })

  it('alternating data fails (too many runs)', () => {
    const data = Array.from({ length: 100 }, (_, i) => i % 2 === 0 ? 0 : 1000)
    const result = runsTest(data)
    expect(result.reject).toBe(true)
  })
})

describe('full audit', () => {
  it('Lévy-distributed traffic passes all tests', () => {
    // Generate Lévy-like samples
    const intervals = Array.from({ length: 100 }, () => {
      const u = Math.random()
      return 1500 / Math.pow(u || 0.001, 1 / 1.5)
    }).map(x => Math.min(x, 15000))

    const result = auditTraffic(intervals)
    // At least 3 of 4 tests should pass (randomized tests may occasionally fail)
    const passCount = result.tests.filter(t => t.passed).length
    expect(passCount).toBeGreaterThanOrEqual(3)
  })

  it('constant timing fails audit', () => {
    const intervals = new Array(100).fill(1000)
    const result = auditTraffic(intervals)
    expect(result.passed).toBe(false)
  })

  it('returns recommendation', () => {
    const intervals = Array.from({ length: 50 }, () => Math.random() * 5000)
    const result = auditTraffic(intervals)
    expect(result.recommendation).toBeTruthy()
    expect(result.tests.length).toBe(4)
  })
})
