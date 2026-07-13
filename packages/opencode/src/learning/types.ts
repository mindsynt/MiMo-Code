export type GraphNodeKind = "skill" | "memory"

export type GraphNode = {
  id: string
  label: string
  kind: GraphNodeKind
  category?: string
  useCount: number
  state: string
  bundled: boolean
  timestamp?: number
  memorySource?: string
}

export type GraphEdge = {
  source: string
  target: string
  weight: number
}

export type GraphCluster = {
  category: string
  count: number
}

export type GraphStats = {
  nodes: number
  edges: number
  edgesPerNode: number
  linkedNodes: number
  isolatedPct: number
  bundled: number
  userCreated: number
  used: number
  memoryNodes: number
  memorySkillEdges: number
}

export type LearningGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
  memory: string[]
  stats: GraphStats
}
