import { Database, eq, desc } from "@/storage"
import { EntityTable, RelationTable } from "./pipeline.sql"
import { RuleProvenanceTable } from "./rules.sql"

/**
 * Upsert a rule entity in the graph with provenance tracking.
 *
 * - If the rule slug already exists as an entity, confidence is boosted.
 * - Provenance is always appended so every source is traceable.
 */
export function upsertRule(input: {
  slug: string
  text: string
  confidence: number
  sessionID: string
  messageID: string
}) {
  const now = Date.now()
  const existing = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.slug)).get())

  if (existing) {
    // Boost confidence on re-mention (same rule in different context)
    const newConfidence = Math.min(1.0, existing.confidence + input.confidence * 0.3)
    Database.use((db) =>
      db
        .update(EntityTable)
        .set({
          context: input.text,
          confidence: newConfidence,
          tier: newConfidence >= 0.8 ? "persistent" : existing.tier,
          updated_at: now,
        })
        .where(eq(EntityTable.id, existing.id))
        .run(),
    )
  } else {
    Database.use((db) =>
      db
        .insert(EntityTable)
        .values({
          name: input.slug,
          type: "rule",
          context: input.text,
          confidence: input.confidence,
          source: "conversation",
          tier: input.confidence >= 0.8 ? "persistent" : "short_term",
          first_seen: now,
          updated_at: now,
        })
        .run(),
    )
  }

  // Always write provenance so every source message is traceable
  Database.use((db) =>
    db
      .insert(RuleProvenanceTable)
      .values({
        rule_name: input.slug,
        session_id: input.sessionID,
        message_id: input.messageID,
        extracted_text: input.text,
        created_at: now,
      })
      .run(),
  )
}

/**
 * Query all rules from the entity graph.
 */
export function queryRules(): Array<{
  slug: string
  text: string
  confidence: number
  tier: string
}> {
  const rows = Database.use((db) =>
    db
      .select({
        name: EntityTable.name,
        context: EntityTable.context,
        confidence: EntityTable.confidence,
        tier: EntityTable.tier,
      })
      .from(EntityTable)
      .where(eq(EntityTable.type, "rule"))
      .orderBy(desc(EntityTable.confidence))
      .all(),
  )
  return rows.map((r) => ({
    slug: r.name,
    text: r.context ?? "",
    confidence: r.confidence,
    tier: r.tier,
  }))
}

/**
 * Query provenance for a specific rule.
 */
export function queryRuleProvenance(
  slug: string,
): Array<{ sessionID: string; messageID: string; text: string; createdAt: number }> {
  const rows = Database.use((db) =>
    db
      .select()
      .from(RuleProvenanceTable)
      .where(eq(RuleProvenanceTable.rule_name, slug))
      .orderBy(desc(RuleProvenanceTable.created_at))
      .all(),
  )
  return rows.map((r) => ({
    sessionID: r.session_id,
    messageID: r.message_id,
    text: r.extracted_text ?? "",
    createdAt: r.created_at,
  }))
}

/**
 * Returns all rules formatted as a Markdown block for context injection.
 */
export function formatRulesForContext(): string {
  const rules = queryRules()
  if (rules.length === 0) return ""
  return [
    "## Project Rules (from memory graph)",
    ...rules.map(
      (r, i) => `${i + 1}. **${r.slug}** — ${r.text} (confidence: ${Math.round(r.confidence * 100)}%, tier: ${r.tier})`,
    ),
  ].join("\n")
}
