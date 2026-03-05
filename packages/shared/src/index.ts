export type NodeType =
  | 'Email'
  | 'Username'
  | 'Person'
  | 'Domain'
  | 'IP'
  | 'Certificate'
  | 'Breach'
  | 'Phone'
  | 'Organization'
  | 'Port'
  | 'Repository'

export type EdgeType =
  | 'EXPOSED_IN'
  | 'USES'
  | 'OWNS'
  | 'RESOLVES_TO'
  | 'HAS_CERT'
  | 'HAS_MX'
  | 'WORKS_AT'
  | 'COMMITTED_TO'
  | 'OPEN_PORT'
  | 'LINKED_TO'
  | 'PROBABLY_IS'

export interface GraphNode {
  id: string
  label: NodeType
  props: Record<string, string>
}

export interface GraphEdge {
  from: string
  to: string
  type: EdgeType
}

export type SeedType = 'email' | 'domain' | 'username' | 'phone'

export function detectSeedType(seed: string): SeedType {
  if (seed.includes('@')) return 'email'
  if (seed.includes('.')) return 'domain'
  if (/^\+?\d[\d\s-]{6,}$/.test(seed)) return 'phone'
  return 'username'
}
