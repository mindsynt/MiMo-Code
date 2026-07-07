import { afterEach, describe, expect, test } from "bun:test"
import { parameters, traverse, subgraph } from "../../src/tool/memory-graph"
import { Database } from "../../src/storage"
import { EntityTable, RelationTable } from "../../src/memory/pipeline.sql"
import { upsertEntity, upsertRelation } from "../../src/memory/entities"

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

createTables()

afterEach(() => {
  Database.use((db) => db.delete(RelationTable).run())
  Database.use((db) => db.delete(EntityTable).run())
})

describe("parameters schema", () => {
  test("sets default operation to traverse", () => {
    const args = parameters.parse({})
    expect(args.operation).toBe("traverse")
  })

  test("sets default depth to 2", () => {
    const args = parameters.parse({})
    expect(args.depth).toBe(2)
  })

  test("accepts subgraph operation", () => {
    const args = parameters.parse({ operation: "subgraph", entities: ["a"] })
    expect(args.operation).toBe("subgraph")
  })
})

describe("traverse", () => {
  test("returns not-found for missing entity", () => {
    const result = traverse("nobody")

    expect(result.title).toContain("entity not found")
    expect(result.output).toContain("nobody")
  })

  test("returns 0 paths for entity with no relations", () => {
    upsertEntity({ name: "loner", type: "concept" })

    const result = traverse("loner")

    expect(result.title).toContain("0 paths")
    expect(result.output).toContain("no outgoing relations")
  })

  test("includes entity metadata when entity has no relations", () => {
    upsertEntity({ name: "meta_check", type: "config", tier: "persistent", confidence: 0.9 })

    const result = traverse("meta_check")

    expect(result.output).toContain("config")
    expect(result.output).toContain("persistent")
    expect(result.output).toContain("0.900")
  })

  test("traverses one level of relations", () => {
    upsertRelation({ source: "a", target: "b", type: "depends_on" })

    const result = traverse("a")

    expect(result.title).toContain("1 path")
    expect(result.output).toContain("a")
    expect(result.output).toContain("depends_on")
    expect(result.output).toContain("b")
    expect(result.output).toContain("[depth 1]")
  })

  test("traverses multiple levels by default (depth 2)", () => {
    upsertRelation({ source: "x", target: "y", type: "calls" })
    upsertRelation({ source: "y", target: "z", type: "calls" })

    const result = traverse("x")

    expect(result.title).toContain("2 paths")
    expect(result.output).toContain("[depth 1]")
    expect(result.output).toContain("[depth 2]")
  })

  test("respects explicit depth parameter", () => {
    upsertRelation({ source: "1", target: "2", type: "chain" })
    upsertRelation({ source: "2", target: "3", type: "chain" })
    upsertRelation({ source: "3", target: "4", type: "chain" })

    const result = traverse("1", undefined, 3)

    expect(result.title).toContain("3 paths")
  })

  test("filters by relation type", () => {
    upsertRelation({ source: "p", target: "q", type: "calls" })
    upsertRelation({ source: "p", target: "r", type: "depends_on" })

    const result = traverse("p", "calls")

    expect(result.title).toContain("1 path")
    expect(result.output).toContain("calls")
    expect(result.output).not.toContain("depends_on")
  })

  test("shows relation filter in output", () => {
    upsertRelation({ source: "m", target: "n", type: "configures" })

    const result = traverse("m", "configures")

    expect(result.output).toContain('filtered by relation "configures"')
  })
})

describe("subgraph", () => {
  test("reports when no entities are found", () => {
    const result = subgraph(["ghost1", "ghost2"])

    expect(result.title).toContain("no entities found")
    expect(result.output).toContain("ghost1")
    expect(result.output).toContain("ghost2")
  })

  test("shows entity type, tier, and confidence", () => {
    upsertEntity({ name: "my_fn", type: "function", tier: "persistent", confidence: 0.85 })

    const result = subgraph(["my_fn"])

    expect(result.output).toContain("my_fn")
    expect(result.output).toContain("function")
    expect(result.output).toContain("persistent")
    expect(result.output).toContain("0.850")
  })

  test("shows relations among requested entities", () => {
    upsertRelation({ source: "alpha", target: "beta", type: "implements" })

    const result = subgraph(["alpha", "beta"])

    expect(result.output).toContain("alpha")
    expect(result.output).toContain("beta")
    expect(result.output).toContain("implements")
  })

  test("reports not-found names alongside found ones", () => {
    upsertEntity({ name: "existing", type: "concept" })

    const result = subgraph(["existing", "missing_one"])

    expect(result.output).toContain("existing")
    expect(result.output).toContain("Not found")
    expect(result.output).toContain("missing_one")
  })

  test("shows multiple relations within the subgraph", () => {
    upsertRelation({ source: "a", target: "b", type: "calls" })
    upsertRelation({ source: "a", target: "c", type: "depends_on" })

    const result = subgraph(["a", "b", "c"])

    expect(result.title).toContain("3 entities")
    expect(result.title).toContain("2 relations")
    expect(result.output).toContain("calls")
    expect(result.output).toContain("depends_on")
  })

  test("returns empty relation count for single entity with no relations", () => {
    upsertEntity({ name: "standalone", type: "concept" })

    const result = subgraph(["standalone"])

    expect(result.title).toContain("0 relations")
    expect(result.metadata.relation_count).toBe(0)
  })
})
