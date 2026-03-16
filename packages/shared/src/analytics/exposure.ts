/**
 * Information-theoretic exposure scoring.
 *
 * Quantifies how much each identity in the graph is "leaking" using
 * Shannon entropy, conditional entropy, and mutual information.
 *
 * The exposure score is measured in bits — the information-theoretic
 * cost of reconstructing the identity from public data.
 *
 * Components:
 * 1. Attribute entropy — how many distinct attributes are linked
 * 2. Cross-source entropy — how many independent sources confirm attributes
 * 3. Breach impact — information leaked through breaches
 * 4. Infrastructure exposure — domains, IPs, ports reachable from identity
 * 5. Conditional entropy chains — H(new_attr | existing_attrs)
 */

import type { GraphNode, GraphEdge, NodeType } from '../index.js'

export interface ExposureScore {
  nodeId: string
  totalBits: number
  breakdown: {
    attributeEntropy: number
    crossSourceEntropy: number
    breachImpact: number
    infrastructureExposure: number
    reachability: number
  }
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Shannon entropy: H(X) = -Σ p(x) log₂ p(x)
 */
function shannonEntropy(probabilities: number[]): number {
  let H = 0
  for (const p of probabilities) {
    if (p > 0) H -= p * Math.log2(p)
  }
  return H
}

/**
 * Weight assigned to each node type for exposure calculation.
 * Higher weight = more sensitive information.
 */
const TYPE_WEIGHTS: Partial<Record<NodeType, number>> = {
  Email: 2.5,
  Phone: 3.0,
  Person: 1.0,
  Username: 1.5,
  Domain: 2.0,
  IP: 2.5,
  Breach: 4.0,     // breaches are high-impact
  Organization: 1.5,
  Repository: 1.0,
  Port: 3.0,        // open ports = infrastructure exposure
  Certificate: 0.5,
}

/**
 * Compute exposure scores for all Person nodes in the graph.
 *
 * For each person, traces all reachable nodes up to maxHops and
 * computes the information-theoretic exposure.
 */
export function computeExposure(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxHops: number = 3,
): ExposureScore[] {
  // Build adjacency lists
  const adj = new Map<string, Set<string>>()
  const nodeMap = new Map<string, GraphNode>()
  for (const n of nodes) {
    nodeMap.set(n.id, n)
    adj.set(n.id, new Set())
  }
  for (const e of edges) {
    adj.get(e.from)?.add(e.to)
    adj.get(e.to)?.add(e.from)
  }

  // Find all Person nodes
  const persons = nodes.filter(n => n.label === 'Person')

  return persons.map(person => scoreNode(person, nodeMap, adj, maxHops))
}

function scoreNode(
  person: GraphNode,
  nodeMap: Map<string, GraphNode>,
  adj: Map<string, Set<string>>,
  maxHops: number,
): ExposureScore {
  // BFS to find all reachable nodes within maxHops
  const visited = new Map<string, number>() // nodeId → distance
  const queue: [string, number][] = [[person.id, 0]]
  visited.set(person.id, 0)

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!
    if (dist >= maxHops) continue

    for (const neighbor of adj.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.set(neighbor, dist + 1)
        queue.push([neighbor, dist + 1])
      }
    }
  }

  // Collect reachable nodes by type
  const byType = new Map<NodeType, GraphNode[]>()
  for (const [id, dist] of visited) {
    if (id === person.id) continue
    const node = nodeMap.get(id)
    if (!node) continue
    const list = byType.get(node.label) ?? []
    list.push(node)
    byType.set(node.label, list)
  }

  // 1. Attribute entropy: diversity of linked node types
  const typeCounts: number[] = []
  const totalReachable = visited.size - 1 // exclude self
  if (totalReachable === 0) {
    return {
      nodeId: person.id,
      totalBits: 0,
      breakdown: {
        attributeEntropy: 0,
        crossSourceEntropy: 0,
        breachImpact: 0,
        infrastructureExposure: 0,
        reachability: 0,
      },
      riskLevel: 'low',
    }
  }

  for (const [, nodes] of byType) {
    typeCounts.push(nodes.length / totalReachable)
  }
  const attributeEntropy = shannonEntropy(typeCounts) * Math.log2(totalReachable + 1)

  // 2. Cross-source entropy: how many independent sources?
  // Each unique domain/platform contributing data is a source
  const sources = new Set<string>()
  for (const [id, dist] of visited) {
    const node = nodeMap.get(id)
    if (!node) continue
    if (node.props.platform) sources.add(node.props.platform)
    if (node.props.source) sources.add(node.props.source)
    if (node.label === 'Domain') sources.add(node.props.name || id)
  }
  const crossSourceEntropy = Math.log2(sources.size + 1)

  // 3. Breach impact: weighted by data classes exposed
  const breaches = byType.get('Breach') ?? []
  let breachBits = 0
  for (const breach of breaches) {
    const dataClasses = breach.props.data_classes?.split(',').length ?? 1
    breachBits += Math.log2(dataClasses + 1) * (TYPE_WEIGHTS.Breach ?? 1)
  }

  // 4. Infrastructure exposure: domains + IPs + open ports
  const infraNodes = [
    ...(byType.get('Domain') ?? []),
    ...(byType.get('IP') ?? []),
    ...(byType.get('Port') ?? []),
  ]
  let infraBits = 0
  for (const node of infraNodes) {
    const weight = TYPE_WEIGHTS[node.label] ?? 1
    // Closer nodes contribute more
    const dist = visited.get(node.id) ?? maxHops
    const distDecay = 1 / (1 + dist * 0.5)
    infraBits += weight * distDecay
  }

  // 5. Reachability: raw graph reachability score
  // More reachable nodes = more exposed
  const reachability = Math.log2(totalReachable + 1)

  // Total exposure in bits
  const totalBits = attributeEntropy + crossSourceEntropy + breachBits + infraBits + reachability

  // Risk level thresholds (calibrated to typical OSINT graphs)
  let riskLevel: ExposureScore['riskLevel'] = 'low'
  if (totalBits > 20) riskLevel = 'critical'
  else if (totalBits > 12) riskLevel = 'high'
  else if (totalBits > 6) riskLevel = 'medium'

  return {
    nodeId: person.id,
    totalBits,
    breakdown: {
      attributeEntropy,
      crossSourceEntropy,
      breachImpact: breachBits,
      infrastructureExposure: infraBits,
      reachability,
    },
    riskLevel,
  }
}
