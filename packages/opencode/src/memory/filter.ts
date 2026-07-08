/**
 * Three-layer memory filter for noise reduction in context injection.
 *
 * Layer 1 — 持久性过滤 (Persistence): 按 tier/confidence/TTL 过滤噪音
 * Layer 2 — 结构化过滤 (Structured): 按类型去重、结构化优先于文本
 * Layer 3 — 个性化过滤 (Personalization): 按当前工作上下文排序
 *
 * Retrieval mirrors storage: hybrid (vector + graph + FTS) at both ends.
 *   - Storage: 向量分块 + 图实体/关系 + FTS 全文索引
 *   - Retrieval: 向量相似性 + 图遍历 + FTS 搜索结果融合 → 三层过滤
 */

import { queryRules } from "./rules"
import { listActiveProfile } from "./profile"
import { hybridSearch, type SearchResult } from "./hybrid-search"

// ─── Types ───────────────────────────────────────────────────────────────────

export type FilterableMemory = {
  type: "rule" | "profile" | "entity" | "chunk" | "note" | "checkpoint" | "memory_file"
  tier?: "core" | "stable" | "ephemeral"
  key?: string
  text: string
  score?: number
  relatesTo?: string[]
  structured: boolean
  updatedAt?: number
}

export type FilterContext = {
  currentEntities?: string[]
  minConfidence?: number
  limit?: number
  includeEphemeral?: boolean
}

/** Minimal interface the hybrid retriever needs. */
export interface MemoryRetriever {
  search: (input: {
    query: string
    limit?: number
  }) => Promise<Array<{ snippet: string; score: number; path?: string; type?: string }>>
  graphTraverse: (input: {
    from: string
    relation?: string
    depth?: number
  }) => Promise<
    Array<{ source_name: string; relation_type: string; target_name: string; target_type: string; depth: number }>
  >
}

// ─── Layer 1: 持久性过滤 ─────────────────────────────────────────────────────

function filterByPersistence(items: FilterableMemory[], ctx: FilterContext): FilterableMemory[] {
  return items.filter((item) => {
    if (item.tier === "core") return true
    if (item.tier === "stable") return true
    if (item.tier === "ephemeral") return ctx.includeEphemeral === true
    return true
  })
}

// ─── Layer 2: 结构化过滤 ──────────────────────────────────────────────────────

function filterByStructure(items: FilterableMemory[]): FilterableMemory[] {
  const structuredKeys = new Set<string>()
  for (const item of items) {
    if (item.structured && item.key) structuredKeys.add(item.key)
  }
  return items.filter((item) => {
    if (item.structured) return true
    if (item.key && structuredKeys.has(item.key)) return false
    return true
  })
}

// ─── Layer 3: 个性化过滤 ──────────────────────────────────────────────────────

function filterByPersonalization(items: FilterableMemory[], ctx: FilterContext): FilterableMemory[] {
  const entities = ctx.currentEntities
  if (!entities || entities.length === 0) return items

  const now = Date.now()
  return items.map((item) => {
    let boost = 0
    if (item.relatesTo) {
      const matchCount = item.relatesTo.filter((r) => entities.some((e) => r.includes(e) || e.includes(r))).length
      boost += matchCount * 0.3
    }
    if (item.updatedAt && now - item.updatedAt < 7 * 86400_000) {
      boost += 0.1
    }
    return { ...item, score: (item.score ?? 0.5) + boost }
  })
}

// ─── Main pipeline (synchronous, for pure filter-only use) ──────────────────

export function filterMemory(items: FilterableMemory[], ctx: FilterContext = {}): FilterableMemory[] {
  if (items.length === 0) return []

  const afterPersistence = filterByPersistence(items, ctx)
  const afterStructure = filterByStructure(afterPersistence)
  const afterPersonalization = filterByPersonalization(afterStructure, ctx)

  afterPersonalization.sort((a, b) => {
    if (a.structured && !b.structured) return -1
    if (!a.structured && b.structured) return 1
    return (b.score ?? 0) - (a.score ?? 0)
  })

  return ctx.limit ? afterPersonalization.slice(0, ctx.limit) : afterPersonalization
}

// ─── Hybrid retrieval + filter (storage → retrieval symmetry) ─────────────

/**
 * Convert a hybrid search result into a FilterableMemory item.
 * Graph results are structured; vector/FTS results are unstructured chunks.
 */
function searchResultToFilterable(r: SearchResult): FilterableMemory {
  const isGraph = r.source === "graph"
  return {
    type: isGraph ? "entity" : "chunk",
    tier: isGraph ? "stable" : "ephemeral",
    text: r.text,
    score: r.score,
    structured: isGraph,
    relatesTo: isGraph ? extractEntities(r.text) : undefined,
  }
}

/** Crude entity extraction from graph path text like "A → B (governs)". */
function extractEntities(text: string): string[] {
  const parts = text.split(" ──[").flatMap((s) => s.split("]──▶ "))
  return parts
    .map((s) => s.replace(/\(.*\)$/, "").trim())
    .filter(Boolean)
    .filter((s) => !s.includes("(") && s.length > 1)
}

/**
 * Build filtered context using hybrid retrieval that mirrors the storage
 * strategy: vector similarity + graph traversal + FTS fused together.
 *
 * 1. Run hybridSearch(query) to retrieve relevant items via all three paths
 * 2. Also gather structured data (rules, profile) via graph + SQL
 * 3. Apply three-layer filter
 * 4. Format as Markdown for context injection
 */
export async function buildFilteredContext(input: {
  /** Natural-language query built from recent user messages / session context */
  query: string
  /** Retriever interface backed by the Memory service */
  memory: MemoryRetriever
  /** Entity names extracted from the current working context */
  currentEntities?: string[]
  /** Max items after filtering (default 15) */
  limit?: number
  /** Include ephemeral/low-confidence items (default false) */
  includeEphemeral?: boolean
}): Promise<string> {
  const { query, memory, currentEntities, limit = 15, includeEphemeral = false } = input
  const items: FilterableMemory[] = []

  // ── 1. Hybrid search: vector + graph + FTS ─────────────────────────────
  try {
    const hybridResults = await hybridSearch(query, memory, { mode: "hybrid", topK: limit * 2 })
    for (const r of hybridResults) {
      items.push(searchResultToFilterable(r))
    }
  } catch {
    // Hybrid search is best-effort
  }

  // ── 2. Structured data via graph traversal from query entities ──────────
  // Traverse from each current entity into the graph to find related
  // rules (governs) and connected concepts. This grounds the retrieval in
  // deterministic relations — the core anti-hallucination mechanism.
  const traversed = new Set<string>()
  for (const entity of currentEntities ?? []) {
    if (traversed.has(entity)) continue
    traversed.add(entity)

    try {
      const paths = await memory.graphTraverse({ from: entity, depth: 1 })
      for (const p of paths) {
        if (p.relation_type === "governs") {
          // The rule entity is the source of governs → target is the file
          items.push({
            type: "rule",
            tier: "core",
            key: `rule:${p.source_name}`,
            text: `${p.source_name} — governs ${p.target_name}`,
            score: 1 / (1 + p.depth),
            structured: true,
            relatesTo: [p.target_name, p.source_name],
          })
        }
        if (p.target_type === "rule") {
          items.push({
            type: "rule",
            tier: "stable",
            key: `rule:${p.target_name}`,
            text: `${p.target_name} (related to ${entity})`,
            score: 0.7 / (1 + p.depth),
            structured: true,
            relatesTo: [entity, p.target_name],
          })
        }
      }
    } catch {
      // Graph traversal is best-effort
    }
  }

  // ── 3. Fallback: all rules + active profile (when query is empty or
  //    no results from hybrid search). Keeps the checkpoint section
  //    non-empty even on cold start.
  if (items.length < 3) {
    for (const rule of queryRules()) {
      items.push({
        type: "rule",
        tier: rule.tier === "persistent" ? "core" : "stable",
        key: `rule:${rule.slug}`,
        text: `**${rule.slug}** — ${rule.text}`,
        score: rule.confidence * 0.8,
        structured: true,
      })
    }
    for (const p of listActiveProfile()) {
      items.push({
        type: "profile",
        tier: p.tier,
        key: `profile:${p.key}`,
        text: `${p.key} = ${p.value}`,
        score: p.confidence * 0.8,
        structured: true,
        relatesTo: [p.value],
      })
    }
  }

  // ── 4. Three-layer filter ──────────────────────────────────────────────
  const filtered = filterMemory(items, { currentEntities, limit, includeEphemeral })

  return formatFilteredItems(filtered)
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatFilteredItems(items: FilterableMemory[]): string {
  if (items.length === 0) return ""

  const sections: string[] = []

  const rules = items.filter((i) => i.type === "rule")
  const profiles = items.filter((i) => i.type === "profile")
  const chunks = items.filter((i) => i.type === "chunk")
  const entities = items.filter((i) => i.type === "entity")

  if (rules.length > 0) {
    sections.push("## Project Rules (memory graph)")
    sections.push(...rules.map((r, i) => `${i + 1}. ${r.text}`))
    sections.push("")
  }

  if (profiles.length > 0) {
    sections.push("## User Profile")
    sections.push(...profiles.map((p) => `  - ${p.text}`))
    sections.push("")
  }

  if (entities.length > 0) {
    sections.push("## Related entities")
    sections.push(...entities.map((e) => `  - ${e.text}`))
    sections.push("")
  }

  if (chunks.length > 0) {
    sections.push("## Related memory chunks")
    sections.push(...chunks.map((c, i) => `  ${i + 1}. ${c.text}`))
    sections.push("")
  }

  return sections.join("\n")
}
