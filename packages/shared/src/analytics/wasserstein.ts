/**
 * Wasserstein (earth mover's) distance between graph snapshots.
 *
 * Given two graph snapshots (before/after a re-scan), computes the
 * optimal transport cost of transforming one into the other. This
 * gives a single metric for "how much did the identity graph change?"
 * plus a transport plan showing which nodes moved where.
 *
 * Uses the Hungarian algorithm (Kuhn-Munkres) for the assignment
 * problem: O(n³) on the number of nodes.
 *
 * The cost function between nodes considers:
 * - Label match (same type = low cost)
 * - Property similarity (Jaro-Winkler on key fields)
 * - Neighborhood structure (shared edge types)
 */

import { jaroWinkler } from '../scoring.js'
import type { GraphNode, GraphEdge } from '../index.js'

export interface TransportPlan {
  /** Assignment pairs: [old node, new node, cost] */
  assignments: { from: string; to: string; cost: number }[]
  /** Nodes in old graph with no match in new graph (deleted) */
  deleted: string[]
  /** Nodes in new graph with no match in old graph (created) */
  created: string[]
  /** Total transport cost (Wasserstein distance) */
  distance: number
  /** Normalized distance: distance / max(|old|, |new|) */
  normalizedDistance: number
}

/**
 * Cost of transporting node A to node B.
 *
 * Returns a value in [0, 1] where 0 = identical and 1 = completely different.
 */
function nodeCost(a: GraphNode, b: GraphNode, adjA: Set<string>, adjB: Set<string>): number {
  // Type mismatch penalty
  const typeCost = a.label === b.label ? 0 : 0.5

  // Property similarity (key fields)
  let propSim = 0
  let propCount = 0
  for (const key of ['address', 'name', 'url']) {
    const va = a.props[key]
    const vb = b.props[key]
    if (va && vb) {
      propSim += va === vb ? 1 : jaroWinkler(va.toLowerCase(), vb.toLowerCase())
      propCount++
    }
  }
  const propCost = propCount > 0 ? 1 - propSim / propCount : 0.5

  // Neighborhood overlap: Jaccard on neighbor sets
  const union = new Set([...adjA, ...adjB])
  const intersection = [...adjA].filter(x => adjB.has(x)).length
  const neighborCost = union.size > 0 ? 1 - intersection / union.size : 0.5

  // Weighted combination
  return 0.3 * typeCost + 0.4 * propCost + 0.3 * neighborCost
}

/**
 * Hungarian algorithm (Kuhn-Munkres) for minimum cost assignment.
 *
 * Given an n×m cost matrix, finds the assignment that minimizes
 * total cost. Runs in O(n²m) time.
 *
 * Implementation follows the Jonker-Volgenant method for rectangular matrices.
 */
function hungarianAssignment(costMatrix: number[][], nRows: number, nCols: number): number[] {
  // Pad to square if needed
  const n = Math.max(nRows, nCols)
  const C: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i < nRows && j < nCols ? costMatrix[i][j] : 0
    )
  )

  const u = new Array(n + 1).fill(0) // row potential
  const v = new Array(n + 1).fill(0) // col potential
  const assignment = new Array(n + 1).fill(0) // col → row
  const way = new Array(n + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    const minV = new Array(n + 1).fill(Infinity)
    const used = new Array(n + 1).fill(false)
    assignment[0] = i

    let j0 = 0
    do {
      used[j0] = true
      const i0 = assignment[j0]
      let delta = Infinity
      let j1 = 0

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = C[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minV[j]) {
          minV[j] = cur
          way[j] = j0
        }
        if (minV[j] < delta) {
          delta = minV[j]
          j1 = j
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[assignment[j]] += delta
          v[j] -= delta
        } else {
          minV[j] -= delta
        }
      }

      j0 = j1
    } while (assignment[j0] !== 0)

    do {
      const j1 = way[j0]
      assignment[j0] = assignment[j1]
      j0 = j1
    } while (j0 !== 0)
  }

  // Result: for each row i, assignment[j]=i means row i is assigned to col j-1
  const result = new Array(nRows).fill(-1)
  for (let j = 1; j <= n; j++) {
    const row = assignment[j] - 1
    const col = j - 1
    if (row >= 0 && row < nRows && col < nCols) {
      result[row] = col
    }
  }

  return result
}

/**
 * Compute the Wasserstein distance and transport plan between two graph snapshots.
 *
 * @param oldNodes - Nodes in the previous snapshot
 * @param oldEdges - Edges in the previous snapshot
 * @param newNodes - Nodes in the current snapshot
 * @param newEdges - Edges in the current snapshot
 */
export function graphDistance(
  oldNodes: GraphNode[],
  oldEdges: GraphEdge[],
  newNodes: GraphNode[],
  newEdges: GraphEdge[],
): TransportPlan {
  if (oldNodes.length === 0 && newNodes.length === 0) {
    return { assignments: [], deleted: [], created: [], distance: 0, normalizedDistance: 0 }
  }
  if (oldNodes.length === 0) {
    return {
      assignments: [],
      deleted: [],
      created: newNodes.map(n => n.id),
      distance: newNodes.length,
      normalizedDistance: 1,
    }
  }
  if (newNodes.length === 0) {
    return {
      assignments: [],
      deleted: oldNodes.map(n => n.id),
      created: [],
      distance: oldNodes.length,
      normalizedDistance: 1,
    }
  }

  // Build adjacency for neighborhood comparison
  const oldAdj = buildAdjMap(oldEdges)
  const newAdj = buildAdjMap(newEdges)

  const nOld = oldNodes.length
  const nNew = newNodes.length

  // Build cost matrix
  const costMatrix: number[][] = Array.from({ length: nOld }, (_, i) =>
    Array.from({ length: nNew }, (_, j) =>
      nodeCost(
        oldNodes[i], newNodes[j],
        oldAdj.get(oldNodes[i].id) ?? new Set(),
        newAdj.get(newNodes[j].id) ?? new Set(),
      )
    )
  )

  // Solve assignment
  const assign = hungarianAssignment(costMatrix, nOld, nNew)

  // Build transport plan
  const assignments: TransportPlan['assignments'] = []
  const matchedNew = new Set<number>()
  let totalCost = 0

  for (let i = 0; i < nOld; i++) {
    const j = assign[i]
    if (j >= 0 && j < nNew) {
      const cost = costMatrix[i][j]
      // Only include meaningful matches (cost < 0.9)
      if (cost < 0.9) {
        assignments.push({ from: oldNodes[i].id, to: newNodes[j].id, cost })
        matchedNew.add(j)
        totalCost += cost
      } else {
        totalCost += 1 // unmatched = full cost
      }
    }
  }

  const matchedOld = new Set(assignments.map(a => a.from))
  const deleted = oldNodes.filter(n => !matchedOld.has(n.id)).map(n => n.id)
  const created = newNodes.filter((_, j) => !matchedNew.has(j)).map(n => n.id)

  totalCost += deleted.length + created.length
  const maxSize = Math.max(nOld, nNew)

  return {
    assignments,
    deleted,
    created,
    distance: totalCost,
    normalizedDistance: maxSize > 0 ? totalCost / maxSize : 0,
  }
}

function buildAdjMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  return adj
}
