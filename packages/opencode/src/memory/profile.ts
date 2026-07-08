import { Database, eq, and, lt, or, desc, sql } from "@/storage"
import { ProfileTable } from "./profile.sql"

export type ProfileTier = "core" | "stable" | "ephemeral"

export interface ProfileEntry {
  key: string
  value: string
  category: "explicit_preference" | "inferred_pattern" | "hidden_intent"
  confidence: number
  source: string
  tier: ProfileTier
}

/**
 * Upsert a profile entry with tier promotion logic:
 *
 * - confidence >= 0.9 → core (never expires)
 * - confidence >= 0.6 → stable (long TTL)
 * - else → ephemeral (short TTL)
 *
 * Repeated mention (same key) boosts confidence and may promote tier.
 */
export function upsertPreference(entry: ProfileEntry): void {
  const existing = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, entry.key)).get())
  const now = Date.now()

  if (existing) {
    const mergedConfidence = Math.min(1.0, existing.confidence + entry.confidence * 0.5)
    const newTier = resolveTier(mergedConfidence, existing.tier)
    Database.use((db) =>
      db
        .update(ProfileTable)
        .set({
          value: entry.value,
          confidence: mergedConfidence,
          category: entry.category,
          tier: newTier,
          updated_at: now,
        })
        .where(eq(ProfileTable.id, existing.id))
        .run(),
    )
  } else {
    const tier = resolveTier(entry.confidence)
    Database.use((db) =>
      db
        .insert(ProfileTable)
        .values({
          key: entry.key,
          value: entry.value,
          category: entry.category,
          confidence: Math.min(1.0, entry.confidence),
          source: entry.source,
          tier,
          created_at: now,
          updated_at: now,
        })
        .run(),
    )
  }
}

/** Resolve tier from confidence, never demoting below current tier. */
function resolveTier(confidence: number, current?: string): ProfileTier {
  // Round to avoid floating-point edge cases (0.6 + 0.3 = 0.899999…)
  const rounded = Math.round(confidence * 100) / 100
  if (rounded >= 0.9) return "core"
  if (rounded >= 0.6) return "stable"
  if (current === "core") return "core"
  if (current === "stable") return "stable"
  return "ephemeral"
}

/**
 * Promote a preference entry to a higher tier manually (used by reflection).
 */
export function promotePreference(key: string, newTier: ProfileTier): void {
  Database.use((db) =>
    db.update(ProfileTable).set({ tier: newTier, updated_at: Date.now() }).where(eq(ProfileTable.key, key)).run(),
  )
}

export function getPreference(key: string): ProfileEntry | undefined {
  const row = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, key)).get())
  if (!row) return undefined
  return mapRow(row)
}

export function listPreferences(category?: string): ProfileEntry[] {
  const rows = category
    ? Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.category, category)).all())
    : Database.use((db) => db.select().from(ProfileTable).all())
  return rows.map(mapRow)
}

/** List only core/stable preferences — the "active profile" for context injection. */
export function listActiveProfile(): ProfileEntry[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(ProfileTable)
      .where(or(eq(ProfileTable.tier, "core"), eq(ProfileTable.tier, "stable")))
      .orderBy(desc(ProfileTable.confidence))
      .all(),
  )
  return rows.map(mapRow)
}

function mapRow(row: any): ProfileEntry {
  return {
    key: row.key,
    value: row.value,
    category: row.category as ProfileEntry["category"],
    confidence: row.confidence,
    source: row.source,
    tier: row.tier as ProfileTier,
  }
}

/**
 * Tier-aware decay and pruning:
 * - core: 永不衰减，永不删除
 * - stable: confidence 缓慢衰减，90 天无更新后降级为 ephemeral
 * - ephemeral: confidence 较快衰减，30 天无更新后删除
 */
export function decayAndPrune(): { demoted: number; pruned: number } {
  const now = Date.now()

  // stable → ephemeral: confidence < 0.4 and not updated in 90 days
  const stableDowngraded = Database.use((db) =>
    db
      .update(ProfileTable)
      .set({ tier: "ephemeral", updated_at: now })
      .where(
        and(
          eq(ProfileTable.tier, "stable"),
          lt(ProfileTable.confidence, 0.4),
          lt(ProfileTable.updated_at, now - 90 * 86400_000),
        ),
      )
      .run(),
  ) as any

  // ephemeral: decay confidence
  Database.use((db) =>
    db
      .update(ProfileTable)
      .set({ confidence: sql`MAX(0.0, confidence - 0.15)` })
      .where(and(eq(ProfileTable.tier, "ephemeral"), lt(ProfileTable.updated_at, now - 7 * 86400_000)))
      .run(),
  )

  // ephemeral: delete if confidence < 0.01 or not updated in 30 days
  const pruned = Database.Client().$client.run(
    "DELETE FROM memory_user_profile WHERE tier = 'ephemeral' AND (confidence < 0.01 OR updated_at < ?)",
    [now - 30 * 86400_000],
  ) as unknown as { changes: number }

  return {
    demoted: (stableDowngraded as any)?.changes ?? 0,
    pruned: pruned?.changes ?? 0,
  }
}
