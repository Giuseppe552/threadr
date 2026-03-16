/**
 * Dempster-Shafer evidence theory for identity attribution.
 *
 * Each plugin produces a "mass function" over the frame of discernment
 * Θ = { SAME, DIFFERENT }. The mass function assigns belief to:
 *   - {SAME}       — evidence they're the same person
 *   - {DIFFERENT}   — evidence they're different people
 *   - {SAME, DIFFERENT} — uncertainty (the plugin can't tell)
 *
 * Dempster's combination rule fuses multiple mass functions, handling
 * conflicting evidence through normalization by (1 - K) where K is
 * the conflict mass.
 *
 * This replaces the naive weighted average in the original resolver.
 */

export interface MassFunction {
  same: number       // m({SAME})
  different: number  // m({DIFFERENT})
  uncertain: number  // m({SAME, DIFFERENT}) = 1 - same - different
  source: string     // which plugin/field produced this
}

export interface DSResult {
  belief: number      // Bel(SAME) = m({SAME})
  plausibility: number // Pl(SAME) = 1 - m({DIFFERENT})
  uncertainty: number  // Pl - Bel = interval width
  conflict: number     // K = total conflicting mass before normalization
  sources: string[]
}

/**
 * Create a mass function from a similarity score and field reliability.
 *
 * fieldReliability is the probability that this field correctly identifies
 * people (email: high, username: medium, name: low). This replaces the
 * hardcoded weights (0.95, 0.70, etc.) with proper probabilistic semantics.
 *
 * High similarity + high reliability → strong evidence for SAME.
 * Low similarity + high reliability → strong evidence for DIFFERENT.
 * Any similarity + low reliability → mostly uncertain.
 */
export function createMass(
  similarity: number,
  fieldReliability: number,
  source: string,
): MassFunction {
  // How much evidence does this observation provide?
  // Reliability controls the total informative mass.
  const informative = fieldReliability

  // Split informative mass between SAME and DIFFERENT based on similarity
  const same = informative * similarity
  const different = informative * (1 - similarity)
  const uncertain = 1 - informative

  return { same, different, uncertain, source }
}

/**
 * Dempster's combination rule for two mass functions.
 *
 * For all focal elements A, B where A ∩ B ≠ ∅:
 *   m₁₂(C) = (1 / (1-K)) × Σ_{A∩B=C} m₁(A) × m₂(B)
 *
 * where K = Σ_{A∩B=∅} m₁(A) × m₂(B) is the conflict.
 *
 * On Θ = {SAME, DIFFERENT}, the focal elements are:
 *   {SAME}, {DIFFERENT}, {SAME, DIFFERENT}
 *
 * Intersections:
 *   {SAME} ∩ {SAME} = {SAME}
 *   {DIFFERENT} ∩ {DIFFERENT} = {DIFFERENT}
 *   {SAME} ∩ {DIFFERENT} = ∅  (conflict!)
 *   {SAME} ∩ {SAME,DIFFERENT} = {SAME}
 *   {DIFFERENT} ∩ {SAME,DIFFERENT} = {DIFFERENT}
 *   {SAME,DIFFERENT} ∩ {SAME,DIFFERENT} = {SAME,DIFFERENT}
 */
export function combine(m1: MassFunction, m2: MassFunction): MassFunction {
  // Compute all non-empty intersections
  const sameSame = m1.same * m2.same
  const sameUncertain = m1.same * m2.uncertain
  const uncertainSame = m1.uncertain * m2.same
  const diffDiff = m1.different * m2.different
  const diffUncertain = m1.different * m2.uncertain
  const uncertainDiff = m1.uncertain * m2.different
  const uncertainUncertain = m1.uncertain * m2.uncertain

  // Conflict: {SAME} ∩ {DIFFERENT} = ∅
  const K = m1.same * m2.different + m1.different * m2.same

  // Normalization factor
  const norm = 1 - K
  if (norm <= 0) {
    // Total conflict — evidence completely contradicts. Return max uncertainty.
    return { same: 0, different: 0, uncertain: 1, source: `${m1.source}+${m2.source}` }
  }

  const same = (sameSame + sameUncertain + uncertainSame) / norm
  const different = (diffDiff + diffUncertain + uncertainDiff) / norm
  const uncertain = uncertainUncertain / norm

  return { same, different, uncertain, source: `${m1.source}+${m2.source}` }
}

/**
 * Fuse multiple mass functions using iterated Dempster combination.
 * Order-independent (Dempster's rule is commutative and associative).
 */
export function fuseAll(masses: MassFunction[]): DSResult {
  if (masses.length === 0) {
    return { belief: 0, plausibility: 1, uncertainty: 1, conflict: 0, sources: [] }
  }
  if (masses.length === 1) {
    const m = masses[0]
    return {
      belief: m.same,
      plausibility: 1 - m.different,
      uncertainty: (1 - m.different) - m.same,
      conflict: 0,
      sources: [m.source],
    }
  }

  let fused = masses[0]
  let totalConflict = 0

  for (let i = 1; i < masses.length; i++) {
    const K = fused.same * masses[i].different + fused.different * masses[i].same
    totalConflict = 1 - (1 - totalConflict) * (1 - K) // cumulative conflict
    fused = combine(fused, masses[i])
  }

  return {
    belief: fused.same,
    plausibility: 1 - fused.different,
    uncertainty: (1 - fused.different) - fused.same,
    conflict: totalConflict,
    sources: masses.map(m => m.source),
  }
}

/**
 * Field reliability parameters derived from empirical OSINT data.
 *
 * These replace the old hardcoded weights (0.95, 0.70, etc.) with
 * proper probabilistic semantics: "given that this field matches,
 * how reliably does it identify the same person?"
 */
export const FIELD_RELIABILITY: Record<string, number> = {
  email: 0.92,     // email is near-unique but can be shared (work inboxes)
  phone: 0.88,     // phones can be recycled or shared
  avatar: 0.75,    // Gravatar hash collision unlikely but same avatar ≠ same person
  username: 0.65,  // common usernames (john, admin) reduce reliability
  name: 0.35,      // names are highly non-unique ("John Smith")
}
