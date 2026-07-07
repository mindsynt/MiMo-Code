import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database, eq } from "@/storage"
import { EntityTable, RelationTable } from "../../src/memory/pipeline.sql"
import { upsertEntity, queryEntity } from "../../src/memory/entities"
import {
  buildRelationPrompt,
  parseRelationLLMOutput,
  refineRelationsWithLLM,
  setCallLLMForRelations,
  type ExtractedRelation,
} from "../../src/memory/extractors/relations"

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
}

beforeAll(() => {
  createTables()
})

afterEach(() => {
  Database.use((db) => db.delete(RelationTable).run())
  Database.use((db) => db.delete(EntityTable).run())
})

describe("buildRelationPrompt", () => {
  test("includes candidate entities in prompt", () => {
    const candidates = [
      { name: "AuthService", type: "function" },
      { name: "UserModel", type: "concept" },
    ]
    const prompt = buildRelationPrompt("some text", candidates)
    expect(prompt).toContain("AuthService")
    expect(prompt).toContain("UserModel")
    expect(prompt).toContain("(function)")
    expect(prompt).toContain("(concept)")
  })

  test("includes all relation types", () => {
    const prompt = buildRelationPrompt("text", [
      { name: "A", type: "concept" },
      { name: "B", type: "concept" },
    ])
    const types = ["depends_on", "implements", "configures", "calls", "prefers", "part_of", "similar_to", "rejects"]
    for (const t of types) {
      expect(prompt).toContain(t)
    }
  })

  test("truncates text over 4000 chars", () => {
    const longText = "x".repeat(5000)
    const prompt = buildRelationPrompt(longText, [{ name: "A", type: "concept" }])
    // The text block should be exactly 4000 chars; total prompt > 4000 but well under 5000
    expect(prompt.length).toBeGreaterThanOrEqual(4000)
    expect(prompt.length).toBeLessThan(4800)
    // The triple-quote delimited text block should be exactly 4000 chars
    const textStart = prompt.indexOf('"""\n') + 4
    const textEnd = prompt.indexOf('\n"""', textStart)
    const extractedTextLen = textEnd - textStart
    expect(extractedTextLen).toBe(4000)
  })

  test("requires JSON array output", () => {
    const prompt = buildRelationPrompt("text", [
      { name: "A", type: "concept" },
      { name: "B", type: "concept" },
    ])
    expect(prompt).toContain("JSON")
    expect(prompt).toContain("Return []")
  })
})

describe("parseRelationLLMOutput", () => {
  test("parses plain JSON array", () => {
    const input = JSON.stringify([
      { source: "A", target: "B", type: "depends_on", confidence: 0.9 },
      { source: "B", target: "C", type: "calls", confidence: 0.7 },
    ])
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(2)
    expect(result[0].source).toBe("A")
    expect(result[0].target).toBe("B")
    expect(result[0].type).toBe("depends_on")
    expect(result[0].confidence).toBe(0.9)
  })

  test("parses JSON inside markdown code block", () => {
    const input = `Here is the result:
\`\`\`json
[{"source": "X", "target": "Y", "type": "prefers", "confidence": 0.8}]
\`\`\`
`
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe("X")
    expect(result[0].target).toBe("Y")
    expect(result[0].type).toBe("prefers")
    expect(result[0].confidence).toBe(0.8)
  })

  test("parses JSON in plain code block (no lang)", () => {
    const input = `\`\`\`
[{"source": "A", "target": "B", "type": "part_of", "confidence": 0.6}]
\`\`\``
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(1)
  })

  test("filters entries with invalid type", () => {
    const input = JSON.stringify([
      { source: "A", target: "B", type: "depends_on", confidence: 0.9 },
      { source: "C", target: "D", type: "invalid_type", confidence: 0.5 },
    ])
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe("A")
  })

  test("filters entries with missing fields", () => {
    const input = JSON.stringify([
      { source: "A", target: "B", type: "depends_on", confidence: 0.9 },
      { source: "C", confidence: 0.5 }, // missing target and type
      { target: "D", type: "calls", confidence: 0.5 }, // missing source
    ])
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe("A")
  })

  test("filters entries with confidence out of range", () => {
    const input = JSON.stringify([
      { source: "A", target: "B", type: "depends_on", confidence: 1.5 },
      { source: "C", target: "D", type: "calls", confidence: -0.1 },
    ])
    const result = parseRelationLLMOutput(input)
    expect(result).toHaveLength(0)
  })

  test("returns empty array for non-array JSON", () => {
    expect(parseRelationLLMOutput('{"not": "an array"}')).toEqual([])
  })

  test("returns empty array for invalid JSON", () => {
    expect(parseRelationLLMOutput("not json at all")).toEqual([])
  })
})

describe("refineRelationsWithLLM", () => {
  test("does nothing with fewer than 2 candidates", async () => {
    const before = Database.use((db) => db.select().from(RelationTable).all())
    expect(before).toHaveLength(0)
    await refineRelationsWithLLM("some text", [{ name: "OnlyOne", type: "concept" }], "session-1")
    const after = Database.use((db) => db.select().from(RelationTable).all())
    expect(after).toHaveLength(0)
  })

  test("upserts relations and boosts entities from LLM output", async () => {
    // First ensure entities exist
    upsertEntity({ name: "AuthService", type: "function" })
    upsertEntity({ name: "UserModel", type: "concept" })

    // Set up mock LLM
    setCallLLMForRelations(async () =>
      JSON.stringify([{ source: "AuthService", target: "UserModel", type: "depends_on", confidence: 0.8 }]),
    )

    await refineRelationsWithLLM(
      "AuthService depends on UserModel for data access",
      [
        { name: "AuthService", type: "function" },
        { name: "UserModel", type: "concept" },
      ],
      "session-1",
    )

    // Verify relation was created
    const relations = Database.use((db) => db.select().from(RelationTable).all())
    expect(relations).toHaveLength(1)
    expect(relations[0].type).toBe("depends_on")

    // Verify entities had confidence boosted
    const authEntity = queryEntity("AuthService")!
    const userEntity = queryEntity("UserModel")!
    expect(authEntity.confidence).toBeGreaterThan(0.5)
    expect(userEntity.confidence).toBeGreaterThan(0.5)
  })
})
