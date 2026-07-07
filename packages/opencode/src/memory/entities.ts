import { Database, and, eq, lt, sql } from "@/storage"
import { EntityTable, RelationTable } from "./pipeline.sql"

export interface GraphPath {
  source_name: string
  relation_type: string
  target_name: string
  target_type: string
  depth: number
}

export function upsertEntity(input: {
  name: string
  type: string
  context?: string
  confidence?: number
  source?: string
  tier?: string
}) {
  const now = Date.now()
  const existing = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.name)).get())

  if (existing) {
    const delta = input.confidence ?? 0.1
    const newConfidence = Math.min(1.0, existing.confidence + delta)
    const mergedType = existing.type === "concept" && input.type !== "concept" ? input.type : existing.type
    const shouldUpgrade = newConfidence >= 0.8
    const newTier = shouldUpgrade ? "persistent" : (input.tier ?? existing.tier)

    Database.use((db) =>
      db
        .update(EntityTable)
        .set({
          type: mergedType,
          context: input.context ?? existing.context,
          confidence: newConfidence,
          source: input.source ?? existing.source,
          tier: newTier,
          updated_at: now,
        })
        .where(eq(EntityTable.id, existing.id))
        .run(),
    )
    return
  }

  Database.use((db) =>
    db
      .insert(EntityTable)
      .values({
        name: input.name,
        type: input.type,
        context: input.context ?? null,
        confidence: input.confidence ?? 0.5,
        source: input.source ?? "conversation",
        tier: input.tier ?? "short_term",
        first_seen: now,
        updated_at: now,
      })
      .run(),
  )
}

export function queryEntity(name: string) {
  return Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, name)).get())
}

export function upsertRelation(input: { source: string; target: string; type: string; weight?: number }) {
  let sourceEntity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.source)).get())
  if (!sourceEntity) {
    upsertEntity({ name: input.source, type: "concept" })
    sourceEntity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.source)).get())!
  }

  let targetEntity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.target)).get())
  if (!targetEntity) {
    upsertEntity({ name: input.target, type: "concept" })
    targetEntity = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.target)).get())!
  }

  const now = Date.now()
  const existing = Database.use((db) =>
    db
      .select()
      .from(RelationTable)
      .where(
        and(
          eq(RelationTable.source_id, sourceEntity.id),
          eq(RelationTable.target_id, targetEntity.id),
          eq(RelationTable.type, input.type),
        ),
      )
      .get(),
  )

  if (existing) {
    const delta = input.weight ?? 0.1
    Database.use((db) =>
      db
        .update(RelationTable)
        .set({ weight: existing.weight + delta, last_seen: now })
        .where(eq(RelationTable.id, existing.id))
        .run(),
    )
    return
  }

  Database.use((db) =>
    db
      .insert(RelationTable)
      .values({
        source_id: sourceEntity.id,
        target_id: targetEntity.id,
        type: input.type,
        weight: input.weight ?? 0.7,
        first_seen: now,
        last_seen: now,
      })
      .run(),
  )
}

export function boostEntityConfidence(name: string, delta: number) {
  const existing = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, name)).get())
  if (!existing) return

  const newConfidence = Math.min(1.0, existing.confidence + delta)
  const shouldUpgrade = newConfidence >= 0.8
  const newTier = shouldUpgrade ? "persistent" : existing.tier

  Database.use((db) =>
    db
      .update(EntityTable)
      .set({
        confidence: newConfidence,
        tier: newTier,
        updated_at: Date.now(),
      })
      .where(eq(EntityTable.id, existing.id))
      .run(),
  )
}

export function decayLowConfidence(): { pruned: number } {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
  const now = Date.now()

  Database.use((db) =>
    db
      .update(EntityTable)
      .set({
        confidence: sql`MAX(0.0, ${EntityTable.confidence} - 0.1)`,
        updated_at: now,
      })
      .where(and(eq(EntityTable.tier, "short_term"), lt(EntityTable.updated_at, threeDaysAgo)))
      .run(),
  )

  const toDelete = Database.use((db) =>
    db.select({ id: EntityTable.id }).from(EntityTable).where(eq(EntityTable.confidence, 0)).all(),
  )

  if (toDelete.length > 0) {
    Database.use((db) => db.delete(EntityTable).where(eq(EntityTable.confidence, 0)).run())
  }

  return { pruned: toDelete.length }
}

export function traverseGraph(from: string, opts?: { relation?: string; depth?: number }): GraphPath[] {
  const maxDepth = Math.min(opts?.depth ?? 2, 5)

  const relationFilter = opts?.relation
  const sqlStr = relationFilter
    ? `WITH RECURSIVE graph AS (
    SELECT e.id, e.name AS source_name, r.type AS relation_type, et.name AS target_name, et.type AS target_type, 1 AS depth
    FROM memory_entity e
    JOIN memory_relation r ON r.source_id = e.id
    JOIN memory_entity et ON et.id = r.target_id
    WHERE e.name = ? AND r.type = ?
    UNION ALL
    SELECT e.id, g.target_name, r.type, et.name, et.type, g.depth + 1
    FROM graph g
    JOIN memory_entity e ON e.name = g.target_name
    JOIN memory_relation r ON r.source_id = e.id
    JOIN memory_entity et ON et.id = r.target_id
    WHERE g.depth < ? AND r.type = ?
  )
  SELECT source_name, relation_type, target_name, target_type, depth FROM graph`
    : `WITH RECURSIVE graph AS (
    SELECT e.id, e.name AS source_name, r.type AS relation_type, et.name AS target_name, et.type AS target_type, 1 AS depth
    FROM memory_entity e
    JOIN memory_relation r ON r.source_id = e.id
    JOIN memory_entity et ON et.id = r.target_id
    WHERE e.name = ?
    UNION ALL
    SELECT e.id, g.target_name, r.type, et.name, et.type, g.depth + 1
    FROM graph g
    JOIN memory_entity e ON e.name = g.target_name
    JOIN memory_relation r ON r.source_id = e.id
    JOIN memory_entity et ON et.id = r.target_id
    WHERE g.depth < ?
  )
  SELECT source_name, relation_type, target_name, target_type, depth FROM graph`

  const params = relationFilter ? [from, relationFilter, maxDepth, relationFilter] : [from, maxDepth]

  return Database.Client()
    .$client.query(sqlStr)
    .all(...params) as GraphPath[]
}
