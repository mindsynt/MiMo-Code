import { traverseGraph } from "./entities"
import { getVectorIndex, generateEmbedding } from "./vectors"
import type { Interface as MemoryInterface } from "./service"

export type SearchMode = "graph" | "vector" | "fts" | "hybrid"

export interface HybridSearchOpts {
  mode?: SearchMode
  topK?: number
}

export interface SearchResult {
  text: string
  score: number
  source: "graph" | "vector" | "fts"
  chunkId?: number
}

export async function hybridSearch(
  query: string,
  memory:
    | MemoryInterface
    | {
        search: (input: {
          query: string
          limit?: number
        }) => Promise<Array<{ snippet: string; score: number; [k: string]: unknown }>>
      },
  opts?: HybridSearchOpts,
): Promise<SearchResult[]> {
  const mode = opts?.mode ?? "hybrid"
  const topK = opts?.topK ?? 10

  const runGraph = async (): Promise<SearchResult[]> => {
    try {
      const entities = query.match(/\b\w+\b/g) ?? []
      if (entities.length === 0) return []
      const first = entities[0]
      if (!first) return []
      const paths = traverseGraph(first)
      return paths.slice(0, topK).map((p) => ({
        text: `${p.source_name} → ${p.target_name} (${p.relation_type})`,
        score: 1 / (1 + p.depth),
        source: "graph" as const,
      }))
    } catch {
      return []
    }
  }

  const runVector = async (): Promise<SearchResult[]> => {
    try {
      const index = getVectorIndex()
      if (index.size === 0) return []
      const queryVec = await generateEmbedding(query)
      return index.search(queryVec, topK).map((r) => ({
        text: r.chunkText,
        score: r.score,
        source: "vector" as const,
        chunkId: r.chunkId,
      }))
    } catch {
      return []
    }
  }

  const runFts = async (): Promise<SearchResult[]> => {
    try {
      const raw = await (memory as any).search({ query, limit: topK })
      const results: Array<{ snippet: string; score: number }> = Array.isArray(raw) ? raw : []
      return results.map((r) => ({
        text: r.snippet,
        score: Math.max(0, r.score ?? 0),
        source: "fts" as const,
      }))
    } catch {
      return []
    }
  }

  if (mode === "hybrid") {
    const [graph, vector, fts] = await Promise.all([runGraph(), runVector(), runFts()])

    const all = [...graph, ...vector, ...fts]
    if (all.length === 0) return []

    const maxScore = Math.max(...all.map((r) => r.score), 1)
    const weights = { graph: 1.2, vector: 1.0, fts: 0.8 }

    const fused = all.map((r) => ({
      ...r,
      score: (r.score / maxScore) * weights[r.source],
    }))
    fused.sort((a, b) => b.score - a.score)

    // Dedup: if graph results already cover a structured fact, suppress
    // redundant vector/FTS results with near-identical text (cosmetic).
    const seenKeys = new Set<string>()
    const deduped: typeof fused = []
    for (const item of fused) {
      const key = item.text.slice(0, 80) // approximate dedup key
      if (item.source === "graph") {
        seenKeys.add(key)
        deduped.push(item)
      } else if (!seenKeys.has(key)) {
        seenKeys.add(key)
        deduped.push(item)
      }
    }

    return deduped.slice(0, topK)
  }

  switch (mode) {
    case "graph":
      return runGraph()
    case "vector":
      return runVector()
    case "fts":
      return runFts()
    default:
      return []
  }
}
