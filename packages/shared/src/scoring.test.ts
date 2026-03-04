import { describe, it, expect } from 'vitest'
import { jaro, jaroWinkler, compareEntities, computeScore } from './scoring.js'
import type { EntityFields } from './scoring.js'

describe('jaro', () => {
  it('identical strings', () => {
    expect(jaro('abc', 'abc')).toBe(1)
  })

  it('martha/marhta', () => {
    const score = jaro('martha', 'marhta')
    expect(score).toBeCloseTo(0.9444, 3)
  })

  it('completely different', () => {
    expect(jaro('abc', 'xyz')).toBe(0)
  })

  it('empty string', () => {
    expect(jaro('', 'abc')).toBe(0)
  })
})

describe('jaroWinkler', () => {
  it('martha/marhta', () => {
    const score = jaroWinkler('martha', 'marhta')
    expect(score).toBeCloseTo(0.9611, 3)
  })

  it('dwayne/duane', () => {
    const score = jaroWinkler('dwayne', 'duane')
    expect(score).toBeGreaterThan(0.8)
  })

  it('identical', () => {
    expect(jaroWinkler('test', 'test')).toBe(1)
  })
})

describe('entity comparison', () => {
  it('same person across platforms scores high', () => {
    const a: EntityFields = {
      emails: ['john@example.com'],
      phones: [],
      avatarHash: 'abc123',
      usernames: ['johndoe'],
      names: ['John Doe'],
    }
    const b: EntityFields = {
      emails: ['john@example.com'],
      phones: [],
      avatarHash: 'abc123',
      usernames: ['johndoe42'],
      names: ['John Doe'],
    }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    expect(score).toBeGreaterThan(0.85)
  })

  it('partial overlap scores mid-range', () => {
    const a: EntityFields = {
      emails: ['john@work.com'],
      phones: [],
      avatarHash: null,
      usernames: ['johnny'],
      names: ['John Doe'],
    }
    const b: EntityFields = {
      emails: ['j.doe@personal.net'],
      phones: [],
      avatarHash: null,
      usernames: ['jdoe_dev'],
      names: ['J. Doe'],
    }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    expect(score).toBeGreaterThanOrEqual(0.3)
    expect(score).toBeLessThanOrEqual(0.85)
  })

  it('different people same common name scores low', () => {
    const a: EntityFields = {
      emails: ['alice@foo.com'],
      phones: [],
      avatarHash: 'aaa',
      usernames: ['alice_dev'],
      names: ['Alice'],
    }
    const b: EntityFields = {
      emails: ['bob@bar.com'],
      phones: [],
      avatarHash: 'bbb',
      usernames: ['bob_eng'],
      names: ['Bob'],
    }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    expect(score).toBeLessThan(0.6)
  })

  it('single field comparison capped at 0.6', () => {
    const a: EntityFields = {
      emails: [],
      phones: [],
      avatarHash: null,
      usernames: [],
      names: ['John Doe'],
    }
    const b: EntityFields = {
      emails: [],
      phones: [],
      avatarHash: null,
      usernames: [],
      names: ['John Doe'],
    }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    expect(score).toBeLessThanOrEqual(0.6)
  })

  it('single email match also capped', () => {
    const a: EntityFields = {
      emails: ['same@test.com'],
      phones: [],
      avatarHash: null,
      usernames: [],
      names: [],
    }
    const b: EntityFields = {
      emails: ['same@test.com'],
      phones: [],
      avatarHash: null,
      usernames: [],
      names: [],
    }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    // even a perfect email match on its own should be capped
    expect(score).toBeLessThanOrEqual(0.6)
  })

  it('no overlapping fields returns zero', () => {
    const a: EntityFields = { emails: ['a@b.com'], phones: [], avatarHash: null, usernames: [], names: [] }
    const b: EntityFields = { emails: [], phones: [], avatarHash: null, usernames: ['someone'], names: [] }
    const breakdown = compareEntities(a, b)
    const score = computeScore(breakdown)
    expect(score).toBe(0)
  })
})
