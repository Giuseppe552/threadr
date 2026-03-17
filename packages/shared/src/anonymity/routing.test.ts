import { describe, it, expect } from 'vitest'
import { generateSessionNonce, selectProxy, generateProxyMap, uniformityTest } from './routing.js'

describe('session nonce', () => {
  it('generates 32 bytes', () => {
    const nonce = generateSessionNonce()
    expect(nonce).toBeInstanceOf(Uint8Array)
    expect(nonce.length).toBe(32)
  })

  it('generates unique nonces', () => {
    const a = generateSessionNonce()
    const b = generateSessionNonce()
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })
})

describe('selectProxy', () => {
  it('returns index within range', async () => {
    const nonce = generateSessionNonce()
    for (let i = 0; i < 20; i++) {
      const idx = await selectProxy(nonce, `plugin-${i}`, 5)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(5)
    }
  })

  it('same nonce + same plugin = same result', async () => {
    const nonce = generateSessionNonce()
    const a = await selectProxy(nonce, 'github', 5)
    const b = await selectProxy(nonce, 'github', 5)
    expect(a).toBe(b)
  })

  it('different nonce = different result (usually)', async () => {
    const n1 = generateSessionNonce()
    const n2 = generateSessionNonce()
    // Over 10 plugins, at least some should differ
    let diffs = 0
    for (let i = 0; i < 10; i++) {
      const a = await selectProxy(n1, `p${i}`, 5)
      const b = await selectProxy(n2, `p${i}`, 5)
      if (a !== b) diffs++
    }
    expect(diffs).toBeGreaterThan(0)
  })

  it('returns 0 for single proxy', async () => {
    const nonce = generateSessionNonce()
    expect(await selectProxy(nonce, 'anything', 1)).toBe(0)
  })
})

describe('generateProxyMap', () => {
  it('assigns all plugins', async () => {
    const plugins = ['github', 'shodan', 'whois', 'dns', 'crtsh']
    const { assignments } = await generateProxyMap(plugins, 3)
    expect(assignments.size).toBe(5)
    for (const idx of assignments.values()) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(3)
    }
  })
})

describe('uniformityTest', () => {
  it('uniform distribution passes', () => {
    // Manually create uniform assignment
    const assignments = new Map<string, number>()
    for (let i = 0; i < 100; i++) {
      assignments.set(`p${i}`, i % 5)
    }
    const pValue = uniformityTest(assignments, 5)
    expect(pValue).toBeGreaterThan(0.05)
  })

  it('moderately skewed distribution has lower p-value than uniform', () => {
    // Moderately non-uniform: 30, 25, 20, 15, 10
    const assignments = new Map<string, number>()
    for (let i = 0; i < 30; i++) assignments.set(`a${i}`, 0)
    for (let i = 0; i < 25; i++) assignments.set(`b${i}`, 1)
    for (let i = 0; i < 20; i++) assignments.set(`c${i}`, 2)
    for (let i = 0; i < 15; i++) assignments.set(`d${i}`, 3)
    for (let i = 0; i < 10; i++) assignments.set(`e${i}`, 4)
    const skewedP = uniformityTest(assignments, 5)

    // Perfectly uniform: 20, 20, 20, 20, 20
    const uniform = new Map<string, number>()
    for (let i = 0; i < 100; i++) uniform.set(`u${i}`, i % 5)
    const uniformP = uniformityTest(uniform, 5)

    expect(skewedP).toBeLessThan(uniformP)
  })
})
