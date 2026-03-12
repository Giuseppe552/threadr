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

// plugin interface
export interface SeedNode {
  type: NodeType
  key: string
  value: string
}

export interface PluginResult {
  nodes: { label: NodeType; key: string; props: Record<string, string> }[]
  edges: { fromLabel: NodeType; fromKey: string; fromVal: string; toLabel: NodeType; toKey: string; toVal: string; rel: EdgeType }[]
}

export interface Plugin {
  id: string
  name: string
  accepts: NodeType[]
  requiresKey: boolean
  rateLimit: { requests: number; windowMs: number }
  run(seed: SeedNode, keys: KeyRing): Promise<PluginResult>
}

export interface KeyRing {
  get(pluginId: string): string | null
  markBurned(pluginId: string, key: string): void
}
