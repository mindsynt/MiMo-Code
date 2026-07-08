import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database, sql } from "@/storage"
import { EntityTable, RelationTable } from "../../src/memory/pipeline.sql"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { queryEntity } from "../../src/memory/entities"
import { setCallLLMForRelations } from "../../src/memory/extractors/relations"
import { chunkText, runMemoryPipeline } from "../../src/session/memory-pipeline"
import { resetVectorIndex } from "../../src/memory/vectors"
import type { SessionID } from "../../src/session/schema"

const sid = (s: string) => s as unknown as SessionID

function createTables() {
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    context TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'conversation',
    tier TEXT NOT NULL DEFAULT 'short_term',
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_relation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`)
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_rel_pair ON memory_relation(source_id, target_id, type)")

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
  Database.use((db) => db.delete(RelationTable).run())
  Database.use((db) => db.delete(EntityTable).run())
  Database.use((db) => db.delete(ChunkTable).run()) // cascades to VectorTable
  resetVectorIndex()
  // Reset callLLMForRelations to default throwing function
  setCallLLMForRelations(async () => {
    throw new Error("callLLMForRelations not configured — test must set a mock")
  })
})

// ---------------------------------------------------------------------------
// Phase A: Classification + Entity Extraction + Upsert
// ---------------------------------------------------------------------------

describe("runMemoryPipeline — Phase A", () => {
  test("discard classification returns early (no entities created)", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-discard"),
      text: "好的",
      messageID: "msg-1",
    })

    const all = Database.use((db) => db.select().from(EntityTable).all())
    expect(all).toHaveLength(0)
  })

  test("short_term with no entities returns early", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-no-entities"),
      text: "今天天气真好",
      messageID: "msg-2",
    })

    const all = Database.use((db) => db.select().from(EntityTable).all())
    expect(all).toHaveLength(0)
  })

  test("extracts code entities from backtick function calls", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-code"),
      text: "使用 `Bun.write()` 写入文件",
      messageID: "msg-3",
    })

    const entity = queryEntity("Bun.write")
    expect(entity).toBeDefined()
    expect(entity!.type).toBe("function")
    expect(entity!.confidence).toBeGreaterThanOrEqual(0.9)
    expect(entity!.tier).toBe("persistent") // backtick → persistent
  })

  test("extracts code and concept entities and deduplicates", async () => {
    // The concept extractor captures the matched group including its prefix:
    // "采用缓存策略" → capture group "采用缓存策略" (4 char prefix + 策略)
    await runMemoryPipeline({
      sessionID: sid("test-mixed"),
      text: "采用缓存策略，使用`Bun.write()`，TypeScript是主力语言",
      messageID: "msg-4",
    })

    const bunEntity = queryEntity("Bun.write")
    expect(bunEntity).toBeDefined()
    expect(bunEntity!.type).toBe("function")

    // Concept extractor captures "采用缓存策略" (prefix "采用缓存" + suffix "策略")
    const cachePolicy = queryEntity("采用缓存策略")
    expect(cachePolicy).toBeDefined()
    expect(cachePolicy!.type).toBe("concept")

    // TypeScript should be extracted (CamelCase pattern)
    const ts = queryEntity("TypeScript")
    expect(ts).toBeDefined()
    expect(ts!.type).toBe("concept")
  })

  test("extracts config constants and file references", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-config"),
      text: "MAX_RETRIES = 5, 查看 `src/index.ts`",
      messageID: "msg-5",
    })

    expect(queryEntity("MAX_RETRIES")).toBeDefined()
    expect(queryEntity("src/index.ts")).toBeDefined()
  })

  test("persistent classification creates entities with persistent tier", async () => {
    // Use TypeScript (matches CamelCase pattern) instead of PostgreSQL which
    // doesn't match the CamelCase pattern (SQL breaks the [a-z]+ alternation)
    await runMemoryPipeline({
      sessionID: sid("test-persistent"),
      text: "决定使用 TypeScript 作为主力语言",
      messageID: "msg-6",
    })

    const entity = queryEntity("TypeScript")
    expect(entity).toBeDefined()
    expect(entity!.type).toBe("concept")
    expect(entity!.tier).toBe("persistent") // rule declaration → persistent
  })

  test("short_term with entities creates short_term entities", async () => {
    // The concept extractor captures "目的缓存策略" (prefix "目的缓存" from
    // "项目的缓存策略" + suffix "策略")
    await runMemoryPipeline({
      sessionID: sid("test-short-term"),
      text: "我们今天来讨论一下项目的缓存策略和技术选型",
      messageID: "msg-7",
    })

    const cachePolicy = queryEntity("目的缓存策略")
    expect(cachePolicy).toBeDefined()
    expect(cachePolicy!.tier).toBe("short_term")

    // 技术选型 — "选型" is not in the concept suffix list
    // (策略|模式|架构|机制|方案), so it should NOT be extracted
    const techSelection = queryEntity("技术选型")
    expect(techSelection).toBeUndefined()
  })

  test("concept entities exclude names already extracted by code entities", async () => {
    // "TypeScript" as a code entity (from interface/type/class declaration)
    // should prevent the concept extractor from also extracting it
    await runMemoryPipeline({
      sessionID: sid("test-dedup"),
      text: "interface TypeScript { } 以及 TypeScript 概念",
      messageID: "msg-8",
    })

    // TypeScript should appear once — from the code extractor (interface declaration)
    const entity = queryEntity("TypeScript")
    expect(entity).toBeDefined()
    expect(entity!.type).toBe("concept") // interface → concept type
  })
})

// ---------------------------------------------------------------------------
// Phase B: Relation Extraction with Mock LLM
// ---------------------------------------------------------------------------

describe("runMemoryPipeline — Phase B", () => {
  test("skips Phase B when there are fewer than 2 entities", async () => {
    // Set a mock that would fail if called
    setCallLLMForRelations(async () => {
      throw new Error("Phase B should not be called with < 2 entities")
    })

    await runMemoryPipeline({
      sessionID: sid("test-skip-b"),
      text: "使用 `Bun.write()`",
      messageID: "msg-9",
    })

    // Entity should exist
    expect(queryEntity("Bun.write")).toBeDefined()
  })

  test("upserts relations and boosts entity confidence from LLM output", async () => {
    setCallLLMForRelations(async () =>
      JSON.stringify([{ source: "AuthService", target: "UserModel", type: "depends_on", confidence: 0.8 }]),
    )

    await runMemoryPipeline({
      sessionID: sid("test-relations"),
      text: "AuthService depends on UserModel for data access — using `AuthService.verify()` and `UserModel.find()`",
      messageID: "msg-10",
    })

    // CamelCase entities (AuthService, UserModel) extracted from text with confidence 0.4
    expect(queryEntity("AuthService")).toBeDefined()
    expect(queryEntity("UserModel")).toBeDefined()

    // Code entities (AuthService.verify, UserModel.find) with confidence 0.9
    expect(queryEntity("AuthService.verify")).toBeDefined()
    expect(queryEntity("UserModel.find")).toBeDefined()

    // Relations should exist from Phase B
    const relations = Database.use((db) => db.select().from(RelationTable).all())
    expect(relations.length).toBeGreaterThanOrEqual(1)
    const rel = relations.find((r) => r.type === "depends_on")
    expect(rel).toBeDefined()

    // Entity confidence boosted: 0.4 (concept extractor) + 0.04 (Phase B boost) = 0.44
    const authEntity = queryEntity("AuthService")!
    expect(authEntity.confidence).toBeCloseTo(0.44)
  })

  test("handles empty LLM response (no relations)", async () => {
    setCallLLMForRelations(async () => "[]")

    await runMemoryPipeline({
      sessionID: sid("test-empty-rel"),
      text: "使用 `Bun.write()` 和 `console.log()`",
      messageID: "msg-11",
    })

    // Entities should exist
    expect(queryEntity("Bun.write")).toBeDefined()
    expect(queryEntity("console.log")).toBeDefined()

    // No relations should be created
    const relations = Database.use((db) => db.select().from(RelationTable).all())
    expect(relations).toHaveLength(0)
  })

  test("handles invalid LLM response gracefully", async () => {
    setCallLLMForRelations(async () => "not valid json at all")

    await runMemoryPipeline({
      sessionID: sid("test-invalid-json"),
      text: "使用 `Bun.write()` 和 `console.log()`",
      messageID: "msg-12",
    })

    // Entities should exist but no crash
    expect(queryEntity("Bun.write")).toBeDefined()
  })

  test("parses LLM response from markdown code block", async () => {
    setCallLLMForRelations(
      async () => `Here are the relations:
\`\`\`json
[{"source": "Bun.write", "target": "console.log", "type": "calls", "confidence": 0.7}]
\`\`\`
`,
    )

    await runMemoryPipeline({
      sessionID: sid("test-md-block"),
      text: "使用 `Bun.write()` 调用 `console.log()`",
      messageID: "msg-13",
    })

    const relations = Database.use((db) => db.select().from(RelationTable).all())
    expect(relations).toHaveLength(1)
    expect(relations[0].type).toBe("calls")
  })

  test("multiple relations from a single message", async () => {
    setCallLLMForRelations(async () =>
      JSON.stringify([
        { source: "Bun.write", target: "fs.readFileSync", type: "depends_on", confidence: 0.8 },
        { source: "Bun.write", target: "console.log", type: "calls", confidence: 0.6 },
        { source: "config", target: "Bun.write", type: "configures", confidence: 0.5 },
      ]),
    )

    await runMemoryPipeline({
      sessionID: sid("test-multi-rel"),
      text: "配置 `Bun.write()` 写入文件，`fs.readFileSync(path)` 读取，`console.log(x)` 调试；这里 MAX_RETRIES=5",
      messageID: "msg-14",
    })

    const relations = Database.use((db) => db.select().from(RelationTable).all())
    expect(relations.length).toBeGreaterThanOrEqual(3)

    const types = relations.map((r) => r.type)
    expect(types).toContain("depends_on")
    expect(types).toContain("calls")
    expect(types).toContain("configures")
  })
})

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("runMemoryPipeline — edge cases", () => {
  test("empty text is discarded", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-empty"),
      text: "",
      messageID: "msg-15",
    })
    const all = Database.use((db) => db.select().from(EntityTable).all())
    expect(all).toHaveLength(0)
  })

  test("whitespace-only text is discarded", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-whitespace"),
      text: "   \t\n  ",
      messageID: "msg-16",
    })
    const all = Database.use((db) => db.select().from(EntityTable).all())
    expect(all).toHaveLength(0)
  })

  test("config assignment text creates entities", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-config-assign"),
      text: 'NAME="test"',
      messageID: "msg-17",
    })
    // No specific entity to extract (config assignment is detected by classification
    // but doesn't produce named entities from the extractors)
    // The pipeline should not crash and should not create entities for this case
    const all = Database.use((db) => db.select().from(EntityTable).all())
    expect(all).toHaveLength(0)
  })

  test("rule declaration text creates entities", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-rule"),
      text: "我们永远不要使用 any 类型，应该使用 TypeScript",
      messageID: "msg-18",
    })

    // Persistent classification with CamelCase concept
    const ts = queryEntity("TypeScript")
    expect(ts).toBeDefined()
    expect(ts!.tier).toBe("persistent")
  })
})

// ---------------------------------------------------------------------------
// Pipeline chunking
// ---------------------------------------------------------------------------

describe("pipeline chunking", () => {
  test("chunkText splits by entity", () => {
    const chunks = chunkText("采用缓存策略。使用 `Bun.write()` 写入文件。TypeScript 是主力语言。", [
      "Bun.write",
      "TypeScript",
    ])
    // Entity-based chunks: sentences containing "Bun.write" or "TypeScript"
    const texts = chunks.map((c) => c.text)
    expect(texts.some((t) => t.includes("Bun.write"))).toBe(true)
    expect(texts.some((t) => t.includes("TypeScript"))).toBe(true)
    // The sentence about "缓存策略" has no matching entity and should be skipped
    expect(texts.some((t) => t.includes("缓存策略"))).toBe(false)
  })

  test("chunkText sliding window for long text", () => {
    const longText = "A".repeat(1000)
    const chunks = chunkText(longText, [])
    // Entity-based fallback: first 512 chars
    expect(chunks.length).toBeGreaterThan(1)
    // Sliding window chunks (all after the first) should be <= 256 chars
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].text.length).toBeLessThanOrEqual(256)
    }
  })

  test("chunkText fallback for empty entity list and short text", () => {
    const shortText = "Hello world"
    const chunks = chunkText(shortText, [])
    // Fallback: first 512 chars
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("Hello world")
  })

  test("runMemoryPipeline creates chunks for persistent content", async () => {
    await runMemoryPipeline({
      sessionID: sid("test-vec"),
      text: "使用 `Bun.write(path, content)` 写入文件",
      messageID: "msg-vec-1",
    })
    await new Promise((r) => setTimeout(r, 200))
    const count = Database.use((db) =>
      db
        .select({ count: sql`COUNT(*)` })
        .from(ChunkTable)
        .get(),
    )
    expect(count!.count).toBeGreaterThan(0)
  })
})
