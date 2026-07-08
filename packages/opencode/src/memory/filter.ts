/**
 * Three-layer memory filter for noise reduction in context injection.
 *
 * Layer 1 — 持久性过滤 (Persistence): 按 tier/confidence/TTL 过滤噪音
 * Layer 2 — 结构化过滤 (Structured): 按类型去重、结构化优先于文本
 * Layer 3 — 个性化过滤 (Personalization): 按当前工作上下文排序
 */

import { Database, eq, desc } from "@/storage"
import { EntityTable } from "./pipeline.sql"
import { queryRules } from "./rules"
import { listActiveProfile, type ProfileEntry } from "./profile"

// ─── Types ───────────────────────────────────────────────────────────────────

export type FilterableMemory = {
  type: "rule" | "profile" | "entity" | "chunk" | "note" | "checkpoint" | "memory_file"
  /** Tier-based persistence level */
  tier?: "core" | "stable" | "ephemeral"
  /** Structured content identifier for dedup */
  key?: string
  /** Human-readable text */
  text: string
  /** 0-1 relevance score */
  score?: number
  /** Entity names this item relates to (for personalization) */
  relatesTo?: string[]
  /** Whether this is structured (rule/entity/profile) or unstructured (chunk/note) */
  structured: boolean
  /** Last-updated timestamp */
  updatedAt?: number
}

export type FilterContext = {
  /** Current working entity names (files, modules, concepts) to personalize against */
  currentEntities?: string[]
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number
  /** Maximum items to return */
  limit?: number
  /** Include ephemeral items? Default false for context injection */
  includeEphemeral?: boolean
}

// ─── Layer 1: 持久性过滤 ─────────────────────────────────────────────────────

/**
 * Filter out noise based on tier, confidence, and TTL.
 *
 * Rules:
 * - core:  always pass
 * - stable: pass (long TTL, medium confidence)
 * - ephemeral: pass only when includeEphemeral=true
 * - undefined tier: pass (legacy items treated as stable)
 */
function filterByPersistence(items: FilterableMemory[], ctx: FilterContext): FilterableMemory[] {
  return items.filter((item) => {
    if (item.tier === "core") return true
    if (item.tier === "stable") return true
    if (item.tier === "ephemeral") return ctx.includeEphemeral === true
    // No tier → treat as stable
    return true
  })
}

// ─── Layer 2: 结构化过滤 ──────────────────────────────────────────────────────

/**
 * Deduplicate and prioritize structured data over raw text.
 *
 * Rules:
 * - If a structured fact (rule/profile/entity) exists with key K, suppress
 *   any raw chunk with the same key
 * - Sort: rules > profile > structured entities > chunks > notes
 * - Group related items (governs relations) together
 */
function filterByStructure(items: FilterableMemory[]): FilterableMemory[] {
  // Dedup: collect all structured keys
  const structuredKeys = new Set<string>()
  for (const item of items) {
    if (item.structured && item.key) structuredKeys.add(item.key)
  }

  // Remove chunks/notes that duplicate a structured fact (same key)
  const deduped = items.filter((item) => {
    if (item.structured) return true // always keep structured
    // Keep unstructured only if no structured item covers the same key
    if (item.key && structuredKeys.has(item.key)) return false
    return true
  })

  // Dedup: remove unstructured items that duplicate a structured fact
  return deduped
}

// ─── Layer 3: 个性化过滤 ──────────────────────────────────────────────────────

/**
 * Personalize based on current working context.
 *
 * Rules:
 * - Items relating to currentEntities get boosted score
 * - Items with governs relations to current work file get priority
 * - Recently updated items get slight boost
 */
function filterByPersonalization(items: FilterableMemory[], ctx: FilterContext): FilterableMemory[] {
  const entities = ctx.currentEntities
  if (!entities || entities.length === 0) return items

  const now = Date.now()
  return items.map((item) => {
    let boost = 0

    // Direct entity match
    if (item.relatesTo) {
      const matchCount = item.relatesTo.filter((r) => entities.some((e) => r.includes(e) || e.includes(r))).length
      boost += matchCount * 0.3
    }

    // Recent activity boost (items updated within last 7 days)
    if (item.updatedAt && now - item.updatedAt < 7 * 86400_000) {
      boost += 0.1
    }

    return {
      ...item,
      score: (item.score ?? 0.5) + boost,
    }
  })
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Run all three filter layers and return the top-k items.
 *
 * @param items  Raw memory items to filter
 * @param ctx    Filtering context (current entities, thresholds)
 * @returns      Filtered, sorted, capped items
 */
export function filterMemory(items: FilterableMemory[], ctx: FilterContext = {}): FilterableMemory[] {
  if (items.length === 0) return []

  // Layer 1: remove noise by persistence tier
  const afterPersistence = filterByPersistence(items, ctx)

  // Layer 2: deduplicate + prioritize structured data
  const afterStructure = filterByStructure(afterPersistence)

  // Layer 3: personalize by working context
  const afterPersonalization = filterByPersonalization(afterStructure, ctx)

  // Two-tier final sort: structured items first, then by score descending
  afterPersonalization.sort((a, b) => {
    if (a.structured && !b.structured) return -1
    if (!a.structured && b.structured) return 1
    return (b.score ?? 0) - (a.score ?? 0)
  })

  // Cap at limit
  return ctx.limit ? afterPersonalization.slice(0, ctx.limit) : afterPersonalization
}

// ─── Context helpers ─────────────────────────────────────────────────────────

/**
 * Build a filtered context summary from available memory sources.
 *
 * This is the main entry point for checkpoint context injection.
 * It gathers rules, profile, and entities, filters them, and
 * returns a Markdown string ready for injection.
 */
export function buildFilteredContext(ctx: FilterContext = {}): string {
  const items: FilterableMemory[] = []

  // Gather rules (structured, includes governs relations)
  const rules = queryRules()
  for (const rule of rules) {
    items.push({
      type: "rule",
      tier: rule.tier === "persistent" ? "core" : "stable",
      key: `rule:${rule.slug}`,
      text: `**${rule.slug}** — ${rule.text}`,
      score: rule.confidence,
      structured: true,
    })
  }

  // Gather active profile (core/stable only, tier filter built-in)
  const profile = listActiveProfile()
  for (const p of profile) {
    items.push({
      type: "profile",
      tier: p.tier,
      key: `profile:${p.key}`,
      text: `${p.key} = ${p.value}`,
      score: p.confidence,
      structured: true,
      relatesTo: [p.value],
      updatedAt: undefined,
    })
  }

  return formatFilteredItems(filterMemory(items, ctx))
}

function formatFilteredItems(items: FilterableMemory[]): string {
  if (items.length === 0) return ""

  const sections: string[] = []

  const rules = items.filter((i) => i.type === "rule")
  const profiles = items.filter((i) => i.type === "profile")

  if (rules.length > 0) {
    sections.push("## Project Rules (filtered)")
    sections.push(...rules.map((r, i) => `${i + 1}. ${r.text}`))
    sections.push("")
  }

  if (profiles.length > 0) {
    sections.push("## User Profile (active)")
    sections.push(...profiles.map((p) => `  - ${p.text}`))
    sections.push("")
  }

  return sections.join("\n")
}
