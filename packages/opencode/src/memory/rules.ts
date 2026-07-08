import { Database, eq, desc, like, or } from "@/storage"
import { EntityTable, RelationTable } from "./pipeline.sql"
import { RuleProvenanceTable } from "./rules.sql"
import { upsertRelation } from "./entities"

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
 * Link a rule to an entity it governs via a `governs` relation.
 *
 * Both the rule entity and the governed entity must already exist in the graph.
 * Idempotent — calling multiple times only boosts the relation weight.
 */
export function linkRuleToEntity(ruleSlug: string, entityName: string) {
  // Only link if both entities exist in the graph (avoids creating orphan
  // concept entities for noise words).
  const rule = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, ruleSlug)).get())
  const entity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, entityName)).get())
  if (!rule || !entity) return

  upsertRelation({
    source: ruleSlug,
    target: entityName,
    type: "governs",
    weight: 0.8,
  })
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
 * Query rules that govern a specific entity (file, concept, package, etc.).
 *
 * Uses LIKE matching so "session.sql" also matches entities stored as
 * "packages/opencode/src/session/session.sql".
 */
export function queryRulesForEntity(entityName: string): Array<{
  slug: string
  text: string
  confidence: number
  tier: string
}> {
  // First find entities whose name matches the given entityName (substring)
  const targetEntities = Database.use((db) =>
    db
      .select({ id: EntityTable.id, name: EntityTable.name })
      .from(EntityTable)
      .where(or(eq(EntityTable.name, entityName), like(EntityTable.name, `%${entityName}%`)))
      .all(),
  )
  if (targetEntities.length === 0) return []

  // Then find rules that have a `governs` relation TO any matching entity
  const targetIds = targetEntities.map((e) => e.id)
  const placeholders = targetIds.map(() => "?").join(",")

  const rows = Database.Client()
    .$client.query(
      `SELECT DISTINCT e.name, e.context, e.confidence, e.tier
       FROM memory_entity e
       JOIN memory_relation r ON r.source_id = e.id
       WHERE r.target_id IN (${placeholders})
         AND r.type = 'governs'
         AND e.type = 'rule'
       ORDER BY e.confidence DESC`,
    )
    .all(...targetIds) as { name: string; context: string | null; confidence: number; tier: string }[]

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
 *
 * When `forEntity` is provided, only rules that govern that entity are included.
 */
export function formatRulesForContext(forEntity?: string): string {
  const rules = forEntity ? queryRulesForEntity(forEntity) : queryRules()
  if (rules.length === 0) return ""

  const header = forEntity ? `## Project Rules applicable to \`${forEntity}\`` : "## Project Rules (from memory graph)"

  // Fetch governed entities for each rule (used in the unfiltered view to
  // show scope). In the filtered view each rule already relates to the
  // queried entity, so the per-rule list would just repeat it.
  const governedMap = forEntity ? null : loadGovernedEntities(rules.map((r) => r.slug))

  return [
    header,
    ...rules.map((r, i) => {
      const scope = governedMap?.get(r.slug)
      const scopeHint =
        scope && scope.length > 0 ? ` · applies to: ${scope.slice(0, 3).join(", ")}${scope.length > 3 ? "…" : ""}` : ""
      return `${i + 1}. **${r.slug}** — ${r.text} (confidence: ${Math.round(r.confidence * 100)}%, tier: ${r.tier}${scopeHint})`
    }),
  ].join("\n")
}

function loadGovernedEntities(slugs: string[]): Map<string, string[]> {
  if (slugs.length === 0) return new Map()
  const placeholders = slugs.map(() => "?").join(",")
  const rows = Database.Client()
    .$client.query(
      `SELECT e.name AS rule_name, et.name AS target_name
       FROM memory_relation r
       JOIN memory_entity e ON e.id = r.source_id
       JOIN memory_entity et ON et.id = r.target_id
       WHERE e.name IN (${placeholders})
         AND r.type = 'governs'
       ORDER BY et.name`,
    )
    .all(...slugs) as { rule_name: string; target_name: string }[]

  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.rule_name) ?? []
    list.push(row.target_name)
    map.set(row.rule_name, list)
  }
  return map
}
