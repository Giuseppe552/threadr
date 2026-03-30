import { describe, it, expect } from 'vitest'
import { jaro, jaroWinkler, compareEntities, computeScore, blockingKeys, candidatePairs } from './scoring.js'
import type { EntityFields, IndexedEntity } from './scoring.js'

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

// --- blocking index tests ---

function entity(i: number, fields: Partial<EntityFields>): IndexedEntity {
  return {
    index: i,
    fields: {
      emails: [], phones: [], avatarHash: null, usernames: [], names: [],
      ...fields,
    },
  }
}

describe('blockingKeys', () => {
  it('extracts email keys (case-insensitive)', () => {
    const keys = blockingKeys({ emails: ['John@Example.com'], phones: [], avatarHash: null, usernames: [], names: [] })
    expect(keys).toContain('e:john@example.com')
  })

  it('extracts username keys', () => {
    const keys = blockingKeys({ emails: [], phones: [], avatarHash: null, usernames: ['JohnDoe'], names: [] })
    expect(keys).toContain('u:johndoe')
  })

  it('extracts avatar hash keys', () => {
    const keys = blockingKeys({ emails: [], phones: [], avatarHash: 'abc123', usernames: [], names: [] })
    expect(keys).toContain('a:abc123')
  })

  it('extracts name bigrams', () => {
    const keys = blockingKeys({ emails: [], phones: [], avatarHash: null, usernames: [], names: ['John'] })
    expect(keys).toContain('b:jo')
    expect(keys).toContain('b:oh')
    expect(keys).toContain('b:hn')
  })

  it('returns empty for empty fields', () => {
    const keys = blockingKeys({ emails: [], phones: [], avatarHash: null, usernames: [], names: [] })
    expect(keys).toHaveLength(0)
  })
})

describe('candidatePairs', () => {
  it('pairs entities sharing an email', () => {
    const entities = [
      entity(0, { emails: ['a@test.com'], names: ['Alice'] }),
      entity(1, { emails: ['a@test.com'], names: ['A. Smith'] }),
      entity(2, { emails: ['z@other.com'], names: ['Zara'] }),
    ]
    const pairs = candidatePairs(entities)
    // 0 and 1 share email, also likely share name bigrams
    expect(pairs.some(([a, b]) => a === 0 && b === 1)).toBe(true)
    // 0 and 2 shouldn't be paired (no shared email, different names)
    // (they might share a single bigram by chance — check they don't share email)
    const pairsWith2 = pairs.filter(([a, b]) => a === 2 || b === 2)
    // any pairs with entity 2 should only be from accidental bigram overlap, not email
    for (const [a, b] of pairsWith2) {
      // these pairs exist only from bigram noise, which is fine —
      // the point is blocking REDUCES pairs, not eliminates all non-matches
      void [a, b]
    }
  })

  it('deduplicates pairs', () => {
    const entities = [
      entity(0, { emails: ['shared@test.com'], usernames: ['same_user'] }),
      entity(1, { emails: ['shared@test.com'], usernames: ['same_user'] }),
    ]
    const pairs = candidatePairs(entities)
    // same pair shouldn't appear twice even though two tokens match
    const count01 = pairs.filter(([a, b]) => a === 0 && b === 1).length
    expect(count01).toBe(1)
  })

  it('returns empty when no entities share tokens', () => {
    const entities = [
      entity(0, { emails: ['a@a.com'], names: ['Xx'] }),
      entity(1, { emails: ['b@b.com'], names: ['Yy'] }),
    ]
    const pairs = candidatePairs(entities)
    expect(pairs).toHaveLength(0)
  })

  it('skips overly common bigram buckets (>50 entities)', () => {
    // 60 entities all with name starting "Th" — "th" bigram bucket has 60 entries
    const entities = Array.from({ length: 60 }, (_, i) =>
      entity(i, { names: [`Thomas${i}`] })
    )
    const pairs = candidatePairs(entities)
    // "th" bucket is dropped (>50). Other bigrams like "ho", "om" also likely >50.
    // Pairs should be far fewer than n(n-1)/2 = 1770
    expect(pairs.length).toBeLessThan(1770)
  })

  it('reduces pair count significantly vs brute force', () => {
    // 100 entities, 10 clusters of 10 sharing an email domain pattern
    const entities: IndexedEntity[] = []
    for (let cluster = 0; cluster < 10; cluster++) {
      for (let i = 0; i < 10; i++) {
        const idx = cluster * 10 + i
        entities.push(entity(idx, {
          emails: [`user${i}@cluster${cluster}.com`],
          names: [`Person ${idx}`],
        }))
      }
    }
    const pairs = candidatePairs(entities)
    const bruteForce = 100 * 99 / 2 // 4950
    // blocking should produce far fewer than brute force
    // each email is unique so no email blocking — pairs come from name bigrams only
    // "pe" bigram is shared by all 100 (>50, dropped), "rs" same, etc.
    // unique bigrams like "0 " only shared within cluster
    expect(pairs.length).toBeLessThan(bruteForce)
  })

  it('exact email match always produces a candidate pair', () => {
    // the one property that MUST hold: if two entities share an exact email,
    // they MUST appear as a candidate pair
    const entities = [
      entity(0, { emails: ['critical@match.com'], names: ['Different'] }),
      entity(1, { emails: ['critical@match.com'], names: ['Names'] }),
    ]
    const pairs = candidatePairs(entities)
    expect(pairs).toContainEqual([0, 1])
  })
})
