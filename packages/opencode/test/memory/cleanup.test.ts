import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { sql } from "drizzle-orm"
import { Database } from "../../src/storage"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { cleanupExpired } from "../../src/memory/cleanup"

beforeAll(() => {
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text TEXT NOT NULL,
    entity_id INTEGER,
    source TEXT DEFAULT 'conversation' NOT NULL,
    tier TEXT DEFAULT 'short_term' NOT NULL,
    ttl INTEGER,
    created_at INTEGER NOT NULL,
    last_accessed INTEGER
  )`)
})

afterEach(() => {
  Database.use((db) => db.delete(ChunkTable).run())
})

describe("cleanupExpired", () => {
  test("removes expired short_term chunks", () => {
    Database.use((db) =>
      db
        .insert(ChunkTable)
        .values({
          chunk_text: "expired data",
          tier: "short_term",
          ttl: Date.now() - 1000,
          created_at: Date.now() - 86400_000,
        })
        .run(),
    )
    const result = cleanupExpired()
    expect(result.expiredChunks).toBeGreaterThan(0)
  })

  test("preserves persistent tier chunks", () => {
    Database.use((db) =>
      db
        .insert(ChunkTable)
        .values({
          chunk_text: "keep this",
          tier: "persistent",
          ttl: Date.now() - 1000,
          created_at: Date.now() - 86400_000,
        })
        .run(),
    )
    const before = Database.use((db) =>
      db
        .select({ count: sql`COUNT(*)` })
        .from(ChunkTable)
        .get(),
    ) as any
    cleanupExpired()
    const after = Database.use((db) =>
      db
        .select({ count: sql`COUNT(*)` })
        .from(ChunkTable)
        .get(),
    ) as any
    // persistent chunks should NOT be removed
    expect(after.count).toBeGreaterThan(0)
  })
})
