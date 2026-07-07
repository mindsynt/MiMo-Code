import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { getTableName } from "drizzle-orm"
import { EntityTable, RelationTable, ClassifyLogTable } from "../../src/memory/pipeline.sql"

describe("memory pipeline schema", () => {
  test("EntityTable has correct table name", () => {
    expect(getTableName(EntityTable)).toBe("memory_entity")
  })

  test("RelationTable has correct table name", () => {
    expect(getTableName(RelationTable)).toBe("memory_relation")
  })

  test("ClassifyLogTable has correct table name", () => {
    expect(getTableName(ClassifyLogTable)).toBe("memory_classify_log")
  })

  test("EntityTable has all required columns", () => {
    expect(EntityTable.id).toBeDefined()
    expect(EntityTable.name).toBeDefined()
    expect(EntityTable.type).toBeDefined()
    expect(EntityTable.context).toBeDefined()
    expect(EntityTable.confidence).toBeDefined()
    expect(EntityTable.source).toBeDefined()
    expect(EntityTable.tier).toBeDefined()
    expect(EntityTable.first_seen).toBeDefined()
    expect(EntityTable.updated_at).toBeDefined()
  })

  test("RelationTable has all required columns", () => {
    expect(RelationTable.id).toBeDefined()
    expect(RelationTable.source_id).toBeDefined()
    expect(RelationTable.target_id).toBeDefined()
    expect(RelationTable.type).toBeDefined()
    expect(RelationTable.weight).toBeDefined()
    expect(RelationTable.first_seen).toBeDefined()
    expect(RelationTable.last_seen).toBeDefined()
  })

  test("ClassifyLogTable has all required columns", () => {
    expect(ClassifyLogTable.id).toBeDefined()
    expect(ClassifyLogTable.session_id).toBeDefined()
    expect(ClassifyLogTable.message_id).toBeDefined()
    expect(ClassifyLogTable.tier).toBeDefined()
    expect(ClassifyLogTable.entities_found).toBeDefined()
    expect(ClassifyLogTable.processing_ms).toBeDefined()
    expect(ClassifyLogTable.created_at).toBeDefined()
  })

  test("EntityTable columns can be created in SQLite", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        context TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        source TEXT NOT NULL DEFAULT 'conversation',
        tier TEXT NOT NULL DEFAULT 'short_term',
        first_seen INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    const row = bunDb.query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entity'").get() as
      { name: string } | undefined
    expect(row).toBeTruthy()
    expect(row!.name).toBe("memory_entity")

    bunDb.close()
  })

  test("RelationTable creation with indices", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )
    `)
    bunDb.run("CREATE UNIQUE INDEX idx_memory_rel_pair ON memory_relation(source_id, target_id, type)")
    bunDb.run("CREATE INDEX idx_memory_rel_source ON memory_relation(source_id)")
    bunDb.run("CREATE INDEX idx_memory_rel_target ON memory_relation(target_id)")
    bunDb.run("CREATE INDEX idx_memory_rel_type ON memory_relation(type)")

    const tableRow = bunDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'")
      .get() as { name: string } | undefined
    expect(tableRow).toBeTruthy()
    expect(tableRow!.name).toBe("memory_relation")

    const idxRow = bunDb
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_rel_pair'")
      .get() as { name: string } | undefined
    expect(idxRow).toBeTruthy()
    expect(idxRow!.name).toBe("idx_memory_rel_pair")

    bunDb.close()
  })

  test("ClassifyLogTable columns can be created in SQLite", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_classify_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        entities_found TEXT,
        processing_ms INTEGER,
        created_at INTEGER NOT NULL
      )
    `)

    const row = bunDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_classify_log'")
      .get() as { name: string } | undefined
    expect(row).toBeTruthy()
    expect(row!.name).toBe("memory_classify_log")

    bunDb.close()
  })
})
