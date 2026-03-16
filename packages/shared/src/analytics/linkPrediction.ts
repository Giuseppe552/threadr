/**
 * Link prediction via Katz centrality and matrix power series.
 *
 * Predicts edges that SHOULD exist but haven't been observed yet.
 * Uses the Katz similarity matrix: S = (I - β·A)^{-1} - I
 *
 * Where A is the adjacency matrix and β < 1/λ_max is the damping
 * factor. S[i][j] counts all paths from i to j, weighted by length:
 *   S[i][j] = β·A + β²·A² + β³·A³ + ...
 *
 * High S[i][j] with no direct edge → predicted link.
 *
 * Also computes:
 * - Jaccard coefficient (shared neighbors / total neighbors)
 * - Adamic-Adar index (sum 1/log(degree) of shared neighbors)
 * - Combined score from all three metrics
 */

export interface PredictedLink {
  from: string
  to: string
  katzScore: number
  jaccardCoeff: number
  adamicAdar: number
  combinedScore: number
}

export interface LinkPredictionResult {
  predictions: PredictedLink[]
  katzCentrality: Map<string, number> // per-node Katz centrality
}

/**
 * Compute the Katz similarity matrix via truncated power series.
 *
 * Instead of matrix inversion (O(n³)), we compute:
 *   S ≈ β·A + β²·A² + ... + β^k·A^k
 *
 * where k is the path length limit. For OSINT graphs, 4-5 hops
 * captures the relevant structure.
 */
function katzSimilarity(
  adj: number[][],
  n: number,
  beta: number,
  maxHops: number,
): number[][] {
  const S: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  let power = adj.map(row => [...row]) // A^1

  for (let hop = 1; hop <= maxHops; hop++) {
    const coeff = Math.pow(beta, hop)

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        S[i][j] += coeff * power[i][j]
      }
    }

    if (hop < maxHops) {
      // A^(hop+1) = A^hop · A
      power = matMul(power, adj, n)
    }
  }

  return S
}

/**
 * Jaccard coefficient for two nodes: |N(i) ∩ N(j)| / |N(i) ∪ N(j)|
 */
function jaccardCoefficient(adj: number[][], i: number, j: number, n: number): number {
  let intersection = 0
  let union = 0
  for (let k = 0; k < n; k++) {
    const ni = adj[i][k] > 0 ? 1 : 0
    const nj = adj[j][k] > 0 ? 1 : 0
    if (ni && nj) intersection++
    if (ni || nj) union++
  }
  return union > 0 ? intersection / union : 0
}

/**
 * Adamic-Adar index: Σ_{z ∈ N(i) ∩ N(j)} 1 / log(deg(z))
 *
 * Shared neighbors with low degree are more informative than hubs.
 */
function adamicAdarIndex(adj: number[][], i: number, j: number, n: number, degree: number[]): number {
  let score = 0
  for (let k = 0; k < n; k++) {
    if (adj[i][k] > 0 && adj[j][k] > 0 && degree[k] > 1) {
      score += 1 / Math.log(degree[k])
    }
  }
  return score
}

/**
 * Estimate the largest eigenvalue of A using power iteration.
 * Used to set β < 1/λ_max for convergence.
 */
function estimateLargestEigenvalue(adj: number[][], n: number): number {
  let v = new Array(n)
  for (let i = 0; i < n; i++) v[i] = 1 / Math.sqrt(n)

  for (let iter = 0; iter < 30; iter++) {
    const w = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) w[i] += adj[i][j] * v[j]
    }
    let norm = 0
    for (const x of w) norm += x * x
    norm = Math.sqrt(norm)
    if (norm === 0) return 0
    for (let i = 0; i < n; i++) v[i] = w[i] / norm
  }

  // Rayleigh quotient
  const Av = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Av[i] += adj[i][j] * v[j]
  }
  let rq = 0
  for (let i = 0; i < n; i++) rq += v[i] * Av[i]
  return rq
}

function matMul(A: number[][], B: number[][], n: number): number[][] {
  const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      if (A[i][k] === 0) continue
      for (let j = 0; j < n; j++) {
        C[i][j] += A[i][k] * B[k][j]
      }
    }
  }
  return C
}

/**
 * Predict missing links in the graph.
 *
 * Returns predicted links sorted by combined score (highest first).
 * Only returns pairs that don't already have a direct edge.
 *
 * @param nodeIds - All node IDs
 * @param edges - Existing edges (undirected)
 * @param maxHops - Maximum path length for Katz (default 5)
 * @param topK - Maximum number of predictions to return (default 20)
 */
export function predictLinks(
  nodeIds: string[],
  edges: { from: string; to: string; weight?: number }[],
  maxHops: number = 5,
  topK: number = 20,
): LinkPredictionResult {
  const n = nodeIds.length
  if (n < 2) return { predictions: [], katzCentrality: new Map() }

  const idToIdx = new Map<string, number>()
  nodeIds.forEach((id, i) => idToIdx.set(id, i))

  // Build adjacency matrix
  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const directEdge = new Set<string>()
  for (const e of edges) {
    const i = idToIdx.get(e.from)
    const j = idToIdx.get(e.to)
    if (i === undefined || j === undefined) continue
    const w = e.weight ?? 1
    adj[i][j] = w
    adj[j][i] = w
    directEdge.add(`${Math.min(i, j)}-${Math.max(i, j)}`)
  }

  // Degree
  const degree = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) degree[i] += adj[i][j] > 0 ? 1 : 0
  }

  // Katz β: must be less than 1/λ_max for convergence
  const lambdaMax = estimateLargestEigenvalue(adj, n)
  const beta = lambdaMax > 0 ? 0.85 / lambdaMax : 0.01

  // Compute Katz similarity
  const S = katzSimilarity(adj, n, beta, maxHops)

  // Katz centrality: row sum of S
  const katzCentrality = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += S[i][j]
    katzCentrality.set(nodeIds[i], sum)
  }

  // Score all non-edge pairs
  const candidates: PredictedLink[] = []

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = `${i}-${j}`
      if (directEdge.has(key)) continue
      if (S[i][j] <= 0) continue

      const katzScore = S[i][j]
      const jaccardCoeff = jaccardCoefficient(adj, i, j, n)
      const adamicAdar = adamicAdarIndex(adj, i, j, n, degree)

      // Normalize and combine: Katz weighted most heavily
      const combined = 0.5 * Math.min(katzScore, 1) +
                        0.3 * jaccardCoeff +
                        0.2 * Math.min(adamicAdar / 3, 1) // normalize AA

      candidates.push({
        from: nodeIds[i],
        to: nodeIds[j],
        katzScore,
        jaccardCoeff,
        adamicAdar,
        combinedScore: combined,
      })
    }
  }

  candidates.sort((a, b) => b.combinedScore - a.combinedScore)

  return {
    predictions: candidates.slice(0, topK),
    katzCentrality,
  }
}
