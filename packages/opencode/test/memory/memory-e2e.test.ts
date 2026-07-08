import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database, sql } from "@/storage"
import { runMemoryPipeline } from "../../src/session/memory-pipeline"
import { EntityTable } from "../../src/memory/pipeline.sql"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { ProfileTable } from "../../src/memory/profile.sql"
import { queryEntity } from "../../src/memory/entities"
import { getPreference } from "../../src/memory/profile"
import { resetVectorIndex } from "../../src/memory/vectors"
import type { SessionID } from "../../src/session/schema"

const sid = (s: string) => s as unknown as SessionID

beforeAll(() => {
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    context TEXT,
    confidence REAL DEFAULT 0.5 NOT NULL,
    source TEXT DEFAULT 'conversation' NOT NULL,
    tier TEXT DEFAULT 'short_term' NOT NULL,
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
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
  db.run(`CREATE TABLE IF NOT EXISTS memory_user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    category TEXT NOT NULL,
    confidence REAL DEFAULT 0.5 NOT NULL,
    source TEXT DEFAULT 'conversation' NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  Database.use((db) => db.delete(EntityTable).run())
  Database.use((db) => db.delete(ChunkTable).run())
  Database.use((db) => db.delete(ProfileTable).run())
  resetVectorIndex()
})

describe("memory pipeline E2E", () => {
  test("classify → extract → chunk → graph", async () => {
    await runMemoryPipeline({
      sessionID: sid("e2e-test"),
      text: "使用 `Bun.write()` 写入文件，必须用 const 声明变量",
      messageID: "e2e-msg-1",
    })

    await new Promise((r) => setTimeout(r, 500))

    // Entity created from code extraction
    const entity = queryEntity("Bun.write")
    expect(entity).toBeDefined()
    expect(entity!.type).toBe("function")

    // Chunks created from the persistent-tier content
    const count = Database.use((db) =>
      db
        .select({ count: sql`COUNT(*)` })
        .from(ChunkTable)
        .get(),
    ) as any
    expect(Number(count.count)).toBeGreaterThan(0)
  })

  test("extracts user preferences from conversation", async () => {
    await runMemoryPipeline({
      sessionID: sid("e2e-pref"),
      text: "我喜欢用 Bun 而不是 npm",
      messageID: "e2e-pref-1",
    })

    await new Promise((r) => setTimeout(r, 200))

    const pref = getPreference("preferred_tool")
    expect(pref).toBeDefined()
    expect(pref!.value).toBe("Bun")
  })
})
