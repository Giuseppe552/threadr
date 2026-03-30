export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  if (!s1.length || !s2.length) return 0

  const range = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1)
  const s1Matches = new Array(s1.length).fill(false)
  const s2Matches = new Array(s2.length).fill(false)

  let matches = 0
  let transpositions = 0

  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, s2.length)

    for (let j = lo; j < hi; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  return (
    matches / s1.length +
    matches / s2.length +
    (matches - transpositions / 2) / matches
  ) / 3
}

export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2)

  // common prefix length, max 4
  let prefix = 0
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }

  return j + prefix * 0.1 * (1 - j)
}

// --- entity resolution ---

export interface EntityFields {
  emails: string[]
  phones: string[]
  avatarHash: string | null
  usernames: string[]
  names: string[]
}

export interface MatchCandidate {
  nodeA: string
  nodeB: string
  score: number
  breakdown: { field: string; similarity: number; weight: number }[]
}

const WEIGHTS: Record<string, number> = {
  email: 0.95,
  phone: 0.90,
  avatar: 0.80,
  username: 0.70,
  name: 0.40,
}

function bestMatch(listA: string[], listB: string[]): number {
  if (!listA.length || !listB.length) return -1
  let best = 0
  for (const a of listA) {
    for (const b of listB) {
      const sim = a.toLowerCase() === b.toLowerCase() ? 1.0 : jaroWinkler(a.toLowerCase(), b.toLowerCase())
      if (sim > best) best = sim
    }
  }
  return best
}

export function compareEntities(a: EntityFields, b: EntityFields): MatchCandidate['breakdown'] {
  const breakdown: MatchCandidate['breakdown'] = []

  const emailSim = bestMatch(a.emails, b.emails)
  if (emailSim >= 0) breakdown.push({ field: 'email', similarity: emailSim, weight: WEIGHTS.email })

  const phoneSim = bestMatch(a.phones, b.phones)
  if (phoneSim >= 0) breakdown.push({ field: 'phone', similarity: phoneSim, weight: WEIGHTS.phone })

  if (a.avatarHash && b.avatarHash) {
    const sim = a.avatarHash === b.avatarHash ? 1.0 : 0.0
    breakdown.push({ field: 'avatar', similarity: sim, weight: WEIGHTS.avatar })
  }

  const userSim = bestMatch(a.usernames, b.usernames)
  if (userSim >= 0) breakdown.push({ field: 'username', similarity: userSim, weight: WEIGHTS.username })

  const nameSim = bestMatch(a.names, b.names)
  if (nameSim >= 0) breakdown.push({ field: 'name', similarity: nameSim, weight: WEIGHTS.name })

  return breakdown
}

export function computeScore(breakdown: MatchCandidate['breakdown']): number {
  if (breakdown.length === 0) return 0

  let totalWeight = 0
  let weightedSum = 0
  for (const b of breakdown) {
    weightedSum += b.similarity * b.weight
    totalWeight += b.weight
  }

  const raw = totalWeight > 0 ? weightedSum / totalWeight : 0

  // single-field comparisons are unreliable — cap at 0.6
  if (breakdown.length === 1) return Math.min(raw, 0.6)

  return raw
}

// --- blocking index for entity resolution ---
//
// Instead of comparing every pair O(n²), build inverted indexes on
// exact tokens (emails, usernames, avatar hashes) and name bigrams.
// Only pairs sharing at least one token become candidates.
// Complexity: O(n × avg_candidates) where avg_candidates is typically small.

export interface IndexedEntity {
  index: number
  fields: EntityFields
}

/**
 * Extract blocking keys from an entity.
 * Each key is a string that, if shared between two entities, makes them
 * candidates for full comparison.
 *
 * Key types:
 *   e:user@example.com   — exact email (case-insensitive)
 *   u:johndoe            — exact username (case-insensitive)
 *   a:abc123             — exact avatar hash
 *   b:jo                 — character bigram from name (case-insensitive)
 */
export function blockingKeys(fields: EntityFields): string[] {
  const keys: string[] = []

  for (const email of fields.emails) {
    keys.push(`e:${email.toLowerCase()}`)
  }
  for (const username of fields.usernames) {
    keys.push(`u:${username.toLowerCase()}`)
  }
  if (fields.avatarHash) {
    keys.push(`a:${fields.avatarHash}`)
  }
  // Name bigrams catch fuzzy matches (typos, abbreviations)
  // "John Doe" → ["jo", "oh", "hn", "n ", " d", "do", "oe"]
  for (const name of fields.names) {
    const lower = name.toLowerCase()
    for (let i = 0; i < lower.length - 1; i++) {
      keys.push(`b:${lower[i]}${lower[i + 1]}`)
    }
  }

  return keys
}

/**
 * Build a blocking index: maps each blocking key to the set of entity
 * indexes that contain it. Returns candidate pairs — only these need
 * full comparison.
 *
 * Deduplicates pairs so each (i, j) appears at most once.
 */
export function candidatePairs(entities: IndexedEntity[]): [number, number][] {
  const index = new Map<string, number[]>()

  for (const entity of entities) {
    const keys = blockingKeys(entity.fields)
    for (const key of keys) {
      let bucket = index.get(key)
      if (!bucket) {
        bucket = []
        index.set(key, bucket)
      }
      bucket.push(entity.index)
    }
  }

  // Collect unique pairs from shared buckets
  const seen = new Set<string>()
  const pairs: [number, number][] = []

  for (const bucket of index.values()) {
    if (bucket.length < 2) continue
    // Skip overly common keys (e.g., bigram "th" matches half the dataset)
    // A bucket with >50 entries is noise, not signal
    if (bucket.length > 50) continue
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = Math.min(bucket[i], bucket[j])
        const b = Math.max(bucket[i], bucket[j])
        const key = `${a}:${b}`
        if (!seen.has(key)) {
          seen.add(key)
          pairs.push([a, b])
        }
      }
    }
  }

  return pairs
}
