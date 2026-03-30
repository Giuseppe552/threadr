import neo4j from 'neo4j-driver'
import { compareEntities, computeScore, candidatePairs } from '@threadr/shared'
import type { EntityFields, IndexedEntity } from '@threadr/shared'

const driver = neo4j.driver(
  process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASS || 'threadr123')
)

interface PersonRow {
  id: string
  name: string
  emails: string[]
  usernames: string[]
  avatar: string | null
}

async function loadPersons(): Promise<PersonRow[]> {
  const session = driver.session()
  try {
    const res = await session.run(`
      MATCH (p:Person)
      OPTIONAL MATCH (p)<-[:LINKED_TO]-(e:Email)
      OPTIONAL MATCH (p)<-[:LINKED_TO]-(u:Username)
      RETURN p.name AS name, elementId(p) AS id,
        collect(DISTINCT e.address) AS emails,
        collect(DISTINCT u.name) AS usernames,
        p.avatar AS avatar
    `)
    return res.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      emails: r.get('emails').filter(Boolean),
      usernames: r.get('usernames').filter(Boolean),
      avatar: r.get('avatar') || null,
    }))
  } finally {
    await session.close()
  }
}

function toFields(p: PersonRow): EntityFields {
  return {
    emails: p.emails,
    phones: [],
    avatarHash: p.avatar,
    usernames: p.usernames,
    names: [p.name],
  }
}

async function writeProbablyIs(idA: string, idB: string, confidence: number, auto: boolean) {
  const session = driver.session()
  try {
    await session.run(
      `MATCH (a) WHERE elementId(a) = $idA
       MATCH (b) WHERE elementId(b) = $idB
       MERGE (a)-[r:PROBABLY_IS]->(b)
       SET r.confidence = $confidence, r.auto = $auto`,
      { idA, idB, confidence, auto }
    )
  } finally {
    await session.close()
  }
}

export async function resolve() {
  const persons = await loadPersons()
  if (persons.length < 2) return

  // Build indexed entities for blocking
  const indexed: IndexedEntity[] = persons.map((p, i) => ({
    index: i,
    fields: toFields(p),
  }))

  // Blocking: only compare pairs that share a token (email, username, avatar, name bigram)
  const pairs = candidatePairs(indexed)

  console.log(`[*] resolver: ${persons.length} persons, ${pairs.length} candidate pairs (blocked from ${persons.length * (persons.length - 1) / 2} total)`)

  let merged = 0
  let suggested = 0

  for (const [i, j] of pairs) {
    const breakdown = compareEntities(indexed[i].fields, indexed[j].fields)
    const score = computeScore(breakdown)

    if (score < 0.3) continue

    if (score >= 0.85) {
      await writeProbablyIs(persons[i].id, persons[j].id, score, true)
      merged++
      console.log(`[+] resolver: ${persons[i].name} ≈ ${persons[j].name} (${score.toFixed(2)}, auto)`)
    } else if (score >= 0.6) {
      await writeProbablyIs(persons[i].id, persons[j].id, score, false)
      suggested++
      console.log(`[?] resolver: ${persons[i].name} ~ ${persons[j].name} (${score.toFixed(2)}, suggest)`)
    }
  }

  console.log(`[*] resolver: ${merged} auto-merged, ${suggested} suggestions`)
}
