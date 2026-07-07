import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database, eq } from "@/storage"
import { ChunkTable, VectorTable } from "../../src/memory/vectors.sql"
import { VectorIndex, resetVectorIndex } from "../../src/memory/vectors"

function createTables() {
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text TEXT NOT NULL,
    entity_id INTEGER,
    source TEXT NOT NULL DEFAULT 'conversation',
    tier TEXT NOT NULL DEFAULT 'short_term',
    ttl INTEGER,
    created_at INTEGER NOT NULL,
    last_accessed INTEGER
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_vector (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id INTEGER NOT NULL UNIQUE REFERENCES memory_chunk(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`)
}

beforeAll(() => {
  createTables()
})

afterEach(() => {
  resetVectorIndex()
  Database.use((db) => db.delete(VectorTable).run())
  Database.use((db) => db.delete(ChunkTable).run())
})

describe("VectorIndex", () => {
  test("starts empty", () => {
    const idx = new VectorIndex(3)
    expect(idx.size).toBe(0)
    expect(idx.search(new Float32Array([1, 0, 0]))).toEqual([])
  })

  test("add + search returns nearest neighbor (verify score > 0.9)", () => {
    Database.use((db) =>
      db.insert(ChunkTable).values({ id: 1, chunk_text: "hello world", created_at: Date.now() }).run(),
    )
    Database.use((db) =>
      db.insert(ChunkTable).values({ id: 2, chunk_text: "goodbye world", created_at: Date.now() }).run(),
    )

    const idx = new VectorIndex(3)
    idx.add(1, new Float32Array([1, 0, 0]), "hello world")
    idx.add(2, new Float32Array([0, 1, 0]), "goodbye world")

    const results = idx.search(new Float32Array([1, 0, 0]))
    expect(results).toHaveLength(2)
    expect(results[0].chunkId).toBe(1)
    expect(results[0].chunkText).toBe("hello world")
    expect(results[0].score).toBeGreaterThan(0.9)
  })

  test("topK limits results", () => {
    for (let i = 1; i <= 5; i++) {
      Database.use((db) =>
        db
          .insert(ChunkTable)
          .values({ id: 100 + i, chunk_text: `chunk ${i}`, created_at: Date.now() })
          .run(),
      )
    }

    const idx = new VectorIndex(3)
    idx.add(101, new Float32Array([1, 0, 0]), "chunk 1")
    idx.add(102, new Float32Array([0, 1, 0]), "chunk 2")
    idx.add(103, new Float32Array([0, 0, 1]), "chunk 3")
    idx.add(104, new Float32Array([1, 1, 0]), "chunk 4")
    idx.add(105, new Float32Array([0, 1, 1]), "chunk 5")

    const results = idx.search(new Float32Array([1, 0, 0]), 2)
    expect(results).toHaveLength(2)
  })

  test("remove eliminates vector", () => {
    Database.use((db) =>
      db.insert(ChunkTable).values({ id: 10, chunk_text: "remove me", created_at: Date.now() }).run(),
    )

    const idx = new VectorIndex(3)
    idx.add(10, new Float32Array([1, 0, 0]), "remove me")
    expect(idx.size).toBe(1)

    idx.remove(10)
    expect(idx.size).toBe(0)
    expect(idx.search(new Float32Array([1, 0, 0]))).toEqual([])
  })

  test("clear removes all", () => {
    for (let i = 1; i <= 3; i++) {
      Database.use((db) =>
        db
          .insert(ChunkTable)
          .values({ id: 200 + i, chunk_text: `clear ${i}`, created_at: Date.now() })
          .run(),
      )
    }

    const idx = new VectorIndex(3)
    idx.add(201, new Float32Array([1, 0, 0]), "clear 1")
    idx.add(202, new Float32Array([0, 1, 0]), "clear 2")
    idx.add(203, new Float32Array([0, 0, 1]), "clear 3")
    expect(idx.size).toBe(3)

    idx.clear()
    expect(idx.size).toBe(0)
    expect(idx.search(new Float32Array([1, 0, 0]))).toEqual([])
  })
})
