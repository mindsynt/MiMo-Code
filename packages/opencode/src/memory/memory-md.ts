/**
 * Differentiated MEMORY.md processing:
 *
 * - Structured sections (Rules, Architecture decisions, Discovered knowledge):
 *   parsed → individual rules → entity graph (type:rule) + governs relations
 *   → vector-embedded chunks
 * - Unstructured sections: FTS-only (reconcile.ts handles this)
 *
 * This bridges the gap between file memory and graph memory: core rules
 * from MEMORY.md get the same entity treatment as pipeline-extracted rules,
 * while narrative sections stay as faithful raw text.
 */

import { Database, eq } from "@/storage"
import { upsertEntity, upsertRelation } from "./entities"
import { upsertRule } from "./rules"
import { extractCodeEntities } from "./extractors/code"
import { extractGovernedEntities } from "./extractors/rules"
import { EntityTable } from "./pipeline.sql"
import { ChunkTable } from "./vectors.sql"
import { Log } from "../util"

const log = Log.create({ service: "memory-md" })

// ─── Section classification ─────────────────────────────────────────────────

type Section = {
  /** Header level (2 for ##, 3 for ###) */
  level: number
  /** Header text */
  title: string
  /** Body text (without the header) */
  body: string
  /** Whether this is a "structured" section whose content goes to graph */
  structured: boolean
}

/** Headers that indicate structured, rule-bearing content. */
const STRUCTURED_HEADERS = [
  "rules",
  "architecture decisions",
  "architecture decision",
  "discovered durable knowledge",
  "项目规则",
  "架构决策",
  "命名规范",
  "conventions",
  "convention",
  "decisions",
  "decision trace",
  "design decisions",
]

function isStructuredHeader(title: string): boolean {
  const lower = title
    .toLowerCase()
    .replace(/^#{1,3}\s+/, "")
    .trim()
  return STRUCTURED_HEADERS.some((h) => lower === h || lower.startsWith(h + " ") || lower.startsWith(h + ":"))
}

// ─── Markdown section parser ─────────────────────────────────────────────────

/**
 * Parse a markdown document into sections by ## and ### headers.
 */
function parseSections(body: string): Section[] {
  const lines = body.split("\n")
  const sections: Section[] = []
  let current: Section | null = null

  for (const raw of lines) {
    const h2 = raw.match(/^##\s+(.+)/)
    const h3 = raw.match(/^###\s+(.+)/)
    if (h2) {
      if (current) sections.push(current)
      current = { level: 2, title: h2[1].trim(), body: "", structured: isStructuredHeader(h2[1]) }
    } else if (h3) {
      if (current) sections.push(current)
      current = { level: 3, title: h3[1].trim(), body: "", structured: isStructuredHeader(h3[1]) }
    } else if (current) {
      current.body += raw + "\n"
    }
  }
  if (current) sections.push(current)

  return sections
}

// ─── Rule extraction from structured sections ────────────────────────────────

/**
 * Extract individual rule entries from a structured section body.
 *
 * Supports formats:
 * - `1. **slug** — description`
 * - `- **slug** — description`
 * - `- text description`
 * - Plain paragraph text (single-rule sections)
 */
function extractSectionRules(section: Section): Array<{ slug: string; text: string; confidence: number }> {
  const lines = section.body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  // Check for numbered or bullet list patterns
  const itemPattern = /^(?:\d+\.|[-*])\s+(?:[*]{2})(.+?)(?:[*]{2})\s*[—\-–]\s*(.+)/
  const simpleBullet = /^(?:\d+\.|[-*])\s+(.+)/

  const results: Array<{ slug: string; text: string; confidence: number }> = []
  const seenSlugs = new Set<string>()

  for (const line of lines) {
    const itemMatch = line.match(itemPattern)
    if (itemMatch) {
      const slug = itemMatch[1]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9\u4e00-\u9fff_]/g, "")
        .slice(0, 80)
      const text = `${itemMatch[1].trim()} — ${itemMatch[2].trim()}`
      if (!seenSlugs.has(slug)) {
        seenSlugs.add(slug)
        results.push({ slug: slug || "rule", text, confidence: 0.85 })
      }
      continue
    }

    const bulletMatch = line.match(simpleBullet)
    if (bulletMatch) {
      const text = bulletMatch[1].trim()
      const slug = text
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9\u4e00-\u9fff_]/g, "")
        .slice(0, 80)
      if (!seenSlugs.has(slug)) {
        seenSlugs.add(slug)
        results.push({ slug: slug || "rule", text, confidence: 0.75 })
      }
    }
  }

  // If no list items found, treat the whole body as one rule
  if (results.length === 0) {
    const text = section.body.trim()
    const slug = text
      .slice(0, 60)
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9\u4e00-\u9fff_]/g, "")
      .slice(0, 80)
    results.push({ slug: slug || "rule", text, confidence: 0.7 })
  }

  return results
}

// ─── Entity linking ──────────────────────────────────────────────────────────

/**
 * Link rules to entities they govern.
 * Creates `governs` relations from each rule to entities found in its text.
 */
function linkRuleToEntities(ruleSlug: string, text: string) {
  const governedNames = extractGovernedEntities(text)
  for (const name of governedNames) {
    // Only create relation if the entity exists in the graph
    const entity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, name)).get())
    if (entity) {
      upsertRelation({ source: ruleSlug, target: name, type: "governs", weight: 0.8 })
    }
  }
}

// ─── Vector embedding for structured content ─────────────────────────────────

/**
 * Chunk + embed structured section content so it's findable via vector search.
 */
async function embedStructuredContent(text: string): Promise<void> {
  if (!text.trim()) return

  const now = Date.now()
  const result = Database.use((db) =>
    db
      .insert(ChunkTable)
      .values({
        chunk_text: text.slice(0, 2000),
        source: "memory_md_structured",
        tier: "persistent",
        ttl: null,
        created_at: now,
      })
      .returning({ id: ChunkTable.id })
      .get(),
  )

  if (result) {
    try {
      const { generateEmbedding, getVectorIndex } = await import("./vectors")
      const embedding = await generateEmbedding(text)
      getVectorIndex().add(result.id, embedding, text)
    } catch (err) {
      log.warn("embedding failed for structured section", { err })
    }
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Process MEMORY.md content through the differentiated pipeline.
 *
 * Called from reconcile.ts after FTS indexing.
 *
 * @param absPath  - Absolute path to the .md file (for provenance)
 * @param body     - Full file content
 * @returns        - Summary of what was processed
 */
export async function processMemoryFile(
  absPath: string,
  body: string,
): Promise<{ rulesExtracted: number; entitiesLinked: number; sectionsEmbedded: number }> {
  const sections = parseSections(body)
  const structuredSections = sections.filter((s) => s.structured)
  let rulesExtracted = 0
  let entitiesLinked = 0
  let sectionsEmbedded = 0

  for (const section of structuredSections) {
    // Extract individual rules from the section
    const rules = extractSectionRules(section)
    for (const rule of rules) {
      // Upsert as graph entity + provenance
      upsertRule({
        slug: rule.slug,
        text: rule.text,
        confidence: rule.confidence,
        sessionID: "memory_md",
        messageID: absPath,
      })
      rulesExtracted++

      // Link to governed entities
      linkRuleToEntities(rule.slug, section.body)
      entitiesLinked++
    }

    // Embed structured section for vector search
    await embedStructuredContent(section.body)
    sectionsEmbedded++
  }

  if (rulesExtracted > 0 || sectionsEmbedded > 0) {
    log.info("memory.md processed", {
      file: absPath,
      structuredSections: structuredSections.length,
      rulesExtracted,
      sectionsEmbedded,
    })
  }

  return { rulesExtracted, entitiesLinked, sectionsEmbedded }
}
