/**
 * Spectral graph analysis via Laplacian eigendecomposition.
 *
 * Computes the normalized graph Laplacian L = I - D^{-1/2} A D^{-1/2}
 * and extracts eigenvalues/eigenvectors using power iteration with
 * deflation. No external linear algebra library — pure TypeScript.
 *
 * Features:
 * - Community detection via spectral clustering (Fiedler vector)
 * - Bridge node identification (nodes that maximally affect spectral gap)
 * - Anomaly scoring (deviation from expected spectral structure)
 * - Graph connectivity metrics (algebraic connectivity = λ₂)
 */

export interface AdjacencyInput {
  nodeIds: string[]
  edges: { from: string; to: string; weight?: number }[]
}

export interface SpectralResult {
  eigenvalues: number[]
  communities: Map<string, number>   // nodeId → cluster assignment
  bridges: string[]                   // nodes whose removal most affects λ₂
  algebraicConnectivity: number       // λ₂ — 0 = disconnected, high = robust
  spectralGap: number                 // λ₂ / λ_max
  anomalyScores: Map<string, number>  // per-node anomaly score
}

/**
 * Build the normalized Laplacian matrix.
 *
 * L_norm = I - D^{-1/2} A D^{-1/2}
 *
 * where A is the weighted adjacency matrix and D is the degree matrix.
 * Eigenvalues of L_norm are in [0, 2].
 */
function buildNormalizedLaplacian(n: number, adj: number[][]): number[][] {
  const degree = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) degree[i] += adj[i][j]
  }

  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        L[i][j] = degree[i] > 0 ? 1 : 0
      } else if (adj[i][j] > 0) {
        const di = Math.sqrt(degree[i])
        const dj = Math.sqrt(degree[j])
        L[i][j] = -adj[i][j] / (di * dj)
      }
    }
  }

  return L
}

/**
 * Power iteration to find the largest eigenvalue/eigenvector of a matrix.
 * Converges when the Rayleigh quotient changes by less than tol.
 */
function powerIteration(
  M: number[][],
  n: number,
  maxIter: number = 200,
  tol: number = 1e-10,
): { eigenvalue: number; eigenvector: number[] } {
  // Start with random-ish vector (deterministic for reproducibility)
  let v = new Array(n)
  for (let i = 0; i < n; i++) v[i] = Math.sin(i * 7.13 + 1.37)
  v = normalize(v)

  let lambda = 0

  for (let iter = 0; iter < maxIter; iter++) {
    // Mv
    const w = matVec(M, v, n)
    const newLambda = dot(v, w, n)

    if (Math.abs(newLambda - lambda) < tol) {
      return { eigenvalue: newLambda, eigenvector: normalize(w) }
    }

    lambda = newLambda
    v = normalize(w)
  }

  return { eigenvalue: lambda, eigenvector: v }
}

/**
 * Find the k smallest eigenvalues/eigenvectors of a symmetric matrix
 * using power iteration on (λ_max · I - M) with deflation.
 *
 * Since power iteration finds the LARGEST eigenvalue, we transform:
 * smallest eigenvector of M = largest eigenvector of (λ_max·I - M)
 */
function smallestEigenpairs(
  M: number[][],
  n: number,
  k: number,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  // First find λ_max
  const { eigenvalue: lambdaMax } = powerIteration(M, n)

  // Transform: B = λ_max · I - M (flips spectrum)
  const B: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? lambdaMax : 0) - M[i][j])
  )

  const eigenvalues: number[] = []
  const eigenvectors: number[][] = []

  let current = B.map(row => [...row])

  for (let t = 0; t < k && t < n; t++) {
    const { eigenvalue, eigenvector } = powerIteration(current, n)
    const realEigen = lambdaMax - eigenvalue
    eigenvalues.push(realEigen)
    eigenvectors.push(eigenvector)

    // Deflation: remove the component along this eigenvector
    // B' = B - λ · v · vᵀ
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        current[i][j] -= eigenvalue * eigenvector[i] * eigenvector[j]
      }
    }
  }

  return { eigenvalues, eigenvectors }
}

// --- linear algebra primitives ---

function dot(a: number[], b: number[], n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

function normalize(v: number[]): number[] {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm === 0) return v
  return v.map(x => x / norm)
}

function matVec(M: number[][], v: number[], n: number): number[] {
  const result = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i] += M[i][j] * v[j]
    }
  }
  return result
}

/**
 * k-means clustering on spectral embedding vectors.
 * Uses k-means++ initialization for stable convergence.
 */
function kMeansClustering(
  vectors: number[][],  // n points, each of dimension d
  k: number,
  maxIter: number = 50,
): number[] {
  const n = vectors.length
  if (n === 0) return []
  const d = vectors[0].length

  // k-means++ initialization
  const centroids: number[][] = []
  // First centroid: index 0
  centroids.push([...vectors[0]])

  for (let c = 1; c < k; c++) {
    // Compute distances to nearest centroid
    const dists = vectors.map(v => {
      let minDist = Infinity
      for (const cent of centroids) {
        let dist = 0
        for (let j = 0; j < d; j++) dist += (v[j] - cent[j]) ** 2
        minDist = Math.min(minDist, dist)
      }
      return minDist
    })
    const total = dists.reduce((a, b) => a + b, 0)
    if (total === 0) break

    // Weighted random selection (deterministic: pick the farthest)
    let maxIdx = 0
    for (let i = 1; i < n; i++) {
      if (dists[i] > dists[maxIdx]) maxIdx = i
    }
    centroids.push([...vectors[maxIdx]])
  }

  // Assignment step
  let assignments = new Array(n).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = new Array(n)
    for (let i = 0; i < n; i++) {
      let bestCluster = 0
      let bestDist = Infinity
      for (let c = 0; c < centroids.length; c++) {
        let dist = 0
        for (let j = 0; j < d; j++) dist += (vectors[i][j] - centroids[c][j]) ** 2
        if (dist < bestDist) { bestDist = dist; bestCluster = c }
      }
      newAssignments[i] = bestCluster
    }

    // Check convergence
    let changed = false
    for (let i = 0; i < n; i++) {
      if (newAssignments[i] !== assignments[i]) { changed = true; break }
    }
    assignments = newAssignments
    if (!changed) break

    // Update centroids
    for (let c = 0; c < centroids.length; c++) {
      const members = assignments.reduce((count, a) => count + (a === c ? 1 : 0), 0)
      if (members === 0) continue
      for (let j = 0; j < d; j++) {
        centroids[c][j] = 0
        for (let i = 0; i < n; i++) {
          if (assignments[i] === c) centroids[c][j] += vectors[i][j]
        }
        centroids[c][j] /= members
      }
    }
  }

  return assignments
}

/**
 * Estimate the number of clusters using the eigengap heuristic.
 * The largest gap between consecutive eigenvalues suggests k.
 */
function estimateK(eigenvalues: number[], maxK: number): number {
  if (eigenvalues.length < 2) return 1

  let bestGap = 0
  let bestK = 1

  for (let i = 0; i < Math.min(eigenvalues.length - 1, maxK); i++) {
    const gap = eigenvalues[i + 1] - eigenvalues[i]
    if (gap > bestGap) {
      bestGap = gap
      bestK = i + 1
    }
  }

  return bestK
}

/**
 * Main entry point: spectral analysis of an identity graph.
 *
 * @param input - Node IDs and weighted edges
 * @param maxClusters - Maximum number of communities to detect (default 10)
 * @returns Spectral analysis results
 */
export function analyzeSpectrum(input: AdjacencyInput, maxClusters: number = 10): SpectralResult {
  const { nodeIds, edges } = input
  const n = nodeIds.length
  const idToIdx = new Map<string, number>()
  nodeIds.forEach((id, i) => idToIdx.set(id, i))

  if (n < 2) {
    return {
      eigenvalues: [],
      communities: new Map(nodeIds.map(id => [id, 0])),
      bridges: [],
      algebraicConnectivity: 0,
      spectralGap: 0,
      anomalyScores: new Map(nodeIds.map(id => [id, 0])),
    }
  }

  // Build adjacency matrix
  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const e of edges) {
    const i = idToIdx.get(e.from)
    const j = idToIdx.get(e.to)
    if (i === undefined || j === undefined) continue
    const w = e.weight ?? 1
    adj[i][j] = w
    adj[j][i] = w // undirected
  }

  // Check connected components (BFS) — number of zero eigenvalues = number of components
  const numComponents = countComponents(n, adj)

  // Build normalized Laplacian
  const L = buildNormalizedLaplacian(n, adj)

  // Compute smallest eigenvalues (up to maxClusters + 1)
  const numEigen = Math.min(maxClusters + 1, n)
  const { eigenvalues, eigenvectors } = smallestEigenpairs(L, n, numEigen)

  // Algebraic connectivity = λ₂ (second smallest eigenvalue)
  // For disconnected graphs, λ₂ = 0 (multiple zero eigenvalues)
  const lambda2 = numComponents > 1 ? 0 : (eigenvalues.length >= 2 ? eigenvalues[1] : 0)

  // Spectral gap
  const lambdaMax = eigenvalues.length > 0 ? eigenvalues[eigenvalues.length - 1] : 0
  const spectralGap = lambdaMax > 0 ? lambda2 / lambdaMax : 0

  // Estimate number of communities
  const k = estimateK(eigenvalues, maxClusters)

  // Spectral embedding: use first k eigenvectors as coordinates
  const embedding: number[][] = Array.from({ length: n }, (_, i) =>
    eigenvectors.slice(0, k).map(ev => ev[i])
  )

  // Cluster the embedding
  const assignments = kMeansClustering(embedding, k)
  const communities = new Map<string, number>()
  nodeIds.forEach((id, i) => communities.set(id, assignments[i]))

  // Bridge detection: nodes whose removal most decreases λ₂
  // Approximation: nodes with high values in the Fiedler vector (eigenvector of λ₂)
  // are at community boundaries
  const fiedler = eigenvectors.length >= 2 ? eigenvectors[1] : new Array(n).fill(0)
  const fiedlerAbs = fiedler.map(Math.abs)
  const fiedlerThreshold = percentile(fiedlerAbs, 0.85)
  const bridges = nodeIds.filter((_, i) => fiedlerAbs[i] >= fiedlerThreshold)

  // Anomaly scoring: how much does each node deviate from its community center?
  const anomalyScores = new Map<string, number>()
  const commCenters: Map<number, number[]> = new Map()
  const commCounts: Map<number, number> = new Map()

  for (let i = 0; i < n; i++) {
    const c = assignments[i]
    if (!commCenters.has(c)) {
      commCenters.set(c, new Array(k).fill(0))
      commCounts.set(c, 0)
    }
    const center = commCenters.get(c)!
    for (let d = 0; d < k; d++) center[d] += embedding[i][d]
    commCounts.set(c, commCounts.get(c)! + 1)
  }
  for (const [c, center] of commCenters) {
    const count = commCounts.get(c)!
    for (let d = 0; d < k; d++) center[d] /= count
  }

  for (let i = 0; i < n; i++) {
    const center = commCenters.get(assignments[i])!
    let dist = 0
    for (let d = 0; d < k; d++) dist += (embedding[i][d] - center[d]) ** 2
    anomalyScores.set(nodeIds[i], Math.sqrt(dist))
  }

  return {
    eigenvalues,
    communities,
    bridges,
    algebraicConnectivity: lambda2,
    spectralGap,
    anomalyScores,
  }
}

function countComponents(n: number, adj: number[][]): number {
  const visited = new Array(n).fill(false)
  let components = 0

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue
    components++
    const stack = [start]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (visited[node]) continue
      visited[node] = true
      for (let j = 0; j < n; j++) {
        if (adj[node][j] > 0 && !visited[j]) stack.push(j)
      }
    }
  }

  return components
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.floor(p * (sorted.length - 1))
  return sorted[idx]
}
