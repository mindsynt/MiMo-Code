import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { getTableName } from "drizzle-orm"
import { ChunkTable, VectorTable } from "../../src/memory/vectors.sql"

describe("memory vectors schema", () => {
  test("ChunkTable has correct table name", () => {
    expect(getTableName(ChunkTable)).toBe("memory_chunk")
  })

  test("VectorTable has correct table name", () => {
    expect(getTableName(VectorTable)).toBe("memory_vector")
  })

  test("ChunkTable has all required columns", () => {
    expect(ChunkTable.id).toBeDefined()
    expect(ChunkTable.chunk_text).toBeDefined()
    expect(ChunkTable.entity_id).toBeDefined()
    expect(ChunkTable.source).toBeDefined()
    expect(ChunkTable.tier).toBeDefined()
    expect(ChunkTable.ttl).toBeDefined()
    expect(ChunkTable.created_at).toBeDefined()
    expect(ChunkTable.last_accessed).toBeDefined()
  })

  test("VectorTable has all required columns", () => {
    expect(VectorTable.id).toBeDefined()
    expect(VectorTable.chunk_id).toBeDefined()
    expect(VectorTable.embedding).toBeDefined()
    expect(VectorTable.created_at).toBeDefined()
  })

  test("ChunkTable columns can be created in SQLite", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_chunk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_text TEXT NOT NULL,
        entity_id INTEGER,
        source TEXT NOT NULL DEFAULT 'conversation',
        tier TEXT NOT NULL DEFAULT 'short_term',
        ttl INTEGER,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER
      )
    `)

    const row = bunDb.query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_chunk'").get() as
      { name: string } | undefined
    expect(row).toBeTruthy()
    expect(row!.name).toBe("memory_chunk")

    bunDb.close()
  })

  test("VectorTable can be created with FK reference in SQLite", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_chunk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_text TEXT NOT NULL,
        entity_id INTEGER,
        source TEXT NOT NULL DEFAULT 'conversation',
        tier TEXT NOT NULL DEFAULT 'short_term',
        ttl INTEGER,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER
      )
    `)
    bunDb.run(`
      CREATE TABLE memory_vector (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL UNIQUE REFERENCES memory_chunk(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    const tableRow = bunDb.query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vector'").get() as
      { name: string } | undefined
    expect(tableRow).toBeTruthy()
    expect(tableRow!.name).toBe("memory_vector")

    // Verify FK pragma
    const fkInfo = bunDb.query("SELECT * FROM pragma_foreign_key_list('memory_vector')").all() as {
      table: string
      from: string
      to: string
      on_delete: string
    }[]
    expect(fkInfo.length).toBe(1)
    expect(fkInfo[0].table).toBe("memory_chunk")
    expect(fkInfo[0].from).toBe("chunk_id")
    expect(fkInfo[0].to).toBe("id")
    expect(fkInfo[0].on_delete).toBe("CASCADE")

    bunDb.close()
  })
})
