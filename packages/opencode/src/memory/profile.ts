import { Database, eq, and, lt, sql } from "@/storage"
import { ProfileTable } from "./profile.sql"

export interface ProfileEntry {
  key: string
  value: string
  category: "explicit_preference" | "inferred_pattern" | "hidden_intent"
  confidence: number
  source: string
}

export function upsertPreference(entry: ProfileEntry): void {
  const existing = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, entry.key)).get())
  const now = Date.now()

  if (existing) {
    const mergedConfidence = Math.min(1.0, existing.confidence + entry.confidence * 0.5)
    Database.use((db) =>
      db
        .update(ProfileTable)
        .set({
          value: entry.value,
          confidence: mergedConfidence,
          category: entry.category,
          updated_at: now,
        })
        .where(eq(ProfileTable.id, existing.id))
        .run(),
    )
  } else {
    Database.use((db) =>
      db
        .insert(ProfileTable)
        .values({
          key: entry.key,
          value: entry.value,
          category: entry.category,
          confidence: Math.min(1.0, entry.confidence),
          source: entry.source,
          created_at: now,
          updated_at: now,
        })
        .run(),
    )
  }
}

export function getPreference(key: string): ProfileEntry | undefined {
  const row = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, key)).get())
  if (!row) return undefined
  return {
    key: row.key,
    value: row.value,
    category: row.category as ProfileEntry["category"],
    confidence: row.confidence,
    source: row.source,
  }
}

export function listPreferences(category?: string): ProfileEntry[] {
  const rows = category
    ? Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.category, category)).all())
    : Database.use((db) => db.select().from(ProfileTable).all())
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    category: r.category as ProfileEntry["category"],
    confidence: r.confidence,
    source: r.source,
  }))
}

export function decayLowConfidencePreferences(): number {
  const now = Date.now()
  const threshold = now - 30 * 86400_000

  Database.use((db) =>
    db
      .update(ProfileTable)
      .set({
        confidence: sql`MAX(0.0, confidence - 0.1)`,
      })
      .where(
        and(
          eq(ProfileTable.category, "inferred_pattern"),
          lt(ProfileTable.confidence, 0.6),
          lt(ProfileTable.updated_at, threshold),
        ),
      )
      .run(),
  )

  const pruned = Database.Client().$client.run(
    "DELETE FROM memory_user_profile WHERE confidence < 0.01 AND category = 'inferred_pattern'",
  )
  return pruned.changes ?? 0
}
