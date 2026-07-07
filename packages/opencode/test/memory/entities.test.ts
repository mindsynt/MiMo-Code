import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database, eq } from "@/storage"
import { EntityTable, RelationTable } from "../../src/memory/pipeline.sql"
import {
  upsertEntity,
  queryEntity,
  upsertRelation,
  boostEntityConfidence,
  decayLowConfidence,
  traverseGraph,
  type GraphPath,
} from "../../src/memory/entities"

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

describe("upsertEntity", () => {
  test("inserts new entity with defaults", () => {
    upsertEntity({ name: "test_fn", type: "function", context: "test function" })

    const entity = queryEntity("test_fn")
    expect(entity).toBeDefined()
    expect(entity!.name).toBe("test_fn")
    expect(entity!.type).toBe("function")
    expect(entity!.context).toBe("test function")
    expect(entity!.confidence).toBe(0.5)
    expect(entity!.tier).toBe("short_term")
    expect(entity!.source).toBe("conversation")
    expect(entity!.first_seen).toBeGreaterThan(0)
    expect(entity!.updated_at).toBeGreaterThan(0)
  })

  test("accumulates confidence on re-insert (+0.1 default)", () => {
    upsertEntity({ name: "acc", type: "concept" })
    expect(queryEntity("acc")!.confidence).toBe(0.5)

    upsertEntity({ name: "acc", type: "concept" })
    expect(queryEntity("acc")!.confidence).toBeCloseTo(0.6)

    upsertEntity({ name: "acc", type: "concept" })
    expect(queryEntity("acc")!.confidence).toBeCloseTo(0.7)
  })

  test("accepts explicit confidence delta", () => {
    upsertEntity({ name: "expl", type: "concept" })
    upsertEntity({ name: "expl", type: "concept", confidence: 0.3 })
    expect(queryEntity("expl")!.confidence).toBeCloseTo(0.8)
  })

  test("auto-upgrades to persistent at confidence >= 0.8", () => {
    upsertEntity({ name: "up", type: "concept", confidence: 0.4 })
    expect(queryEntity("up")!.tier).toBe("short_term")

    upsertEntity({ name: "up", type: "concept", confidence: 0.4 })
    expect(queryEntity("up")!.confidence).toBeCloseTo(0.8)
    expect(queryEntity("up")!.tier).toBe("persistent")
  })

  test("caps confidence at 1.0", () => {
    upsertEntity({ name: "cap", type: "concept" })
    upsertEntity({ name: "cap", type: "concept", confidence: 2.0 })
    expect(queryEntity("cap")!.confidence).toBe(1.0)
  })

  test("merges type from concept to specific", () => {
    upsertEntity({ name: "typ", type: "concept" })
    expect(queryEntity("typ")!.type).toBe("concept")

    upsertEntity({ name: "typ", type: "api" })
    expect(queryEntity("typ")!.type).toBe("api")
  })

  test("keeps existing type when it is already specific", () => {
    upsertEntity({ name: "typ2", type: "function" })
    upsertEntity({ name: "typ2", type: "concept" })
    expect(queryEntity("typ2")!.type).toBe("function")
  })

  test("updates context on re-insert", () => {
    upsertEntity({ name: "ctx", type: "concept", context: "first" })
    expect(queryEntity("ctx")!.context).toBe("first")

    upsertEntity({ name: "ctx", type: "concept", context: "updated" })
    expect(queryEntity("ctx")!.context).toBe("updated")
  })

  test("preserves context when not provided on re-insert", () => {
    upsertEntity({ name: "ctx2", type: "concept", context: "original" })
    upsertEntity({ name: "ctx2", type: "concept" })
    expect(queryEntity("ctx2")!.context).toBe("original")
  })
})

describe("queryEntity", () => {
  test("returns undefined for missing entity", () => {
    expect(queryEntity("nonexistent")).toBeUndefined()
  })

  test("returns entity when found", () => {
    upsertEntity({ name: "find_me", type: "function" })
    const entity = queryEntity("find_me")
    expect(entity).toBeDefined()
    expect(entity!.name).toBe("find_me")
  })
})

describe("upsertRelation", () => {
  test("inserts new relation with default weight", () => {
    upsertEntity({ name: "src", type: "function" })
    upsertEntity({ name: "tgt", type: "api" })
    upsertRelation({ source: "src", target: "tgt", type: "depends_on" })

    const paths = traverseGraph("src")
    expect(paths).toHaveLength(1)
    expect(paths[0].source_name).toBe("src")
    expect(paths[0].relation_type).toBe("depends_on")
    expect(paths[0].target_name).toBe("tgt")
    expect(paths[0].target_type).toBe("api")
    expect(paths[0].depth).toBe(1)
  })

  test("accumulates weight on re-insert (+0.1 default)", () => {
    upsertEntity({ name: "a", type: "concept" })
    upsertEntity({ name: "b", type: "concept" })
    upsertRelation({ source: "a", target: "b", type: "related" })
    upsertRelation({ source: "a", target: "b", type: "related" })
    upsertRelation({ source: "a", target: "b", type: "related" })

    // Still only one relation row
    const paths = traverseGraph("a", { depth: 1 })
    expect(paths).toHaveLength(1)
  })

  test("auto-creates entities when source or target does not exist", () => {
    upsertRelation({ source: "auto_src", target: "auto_tgt", type: "calls" })

    expect(queryEntity("auto_src")).toBeDefined()
    expect(queryEntity("auto_tgt")).toBeDefined()

    const paths = traverseGraph("auto_src")
    expect(paths).toHaveLength(1)
    expect(paths[0].target_name).toBe("auto_tgt")
  })

  test("accepts explicit weight", () => {
    upsertEntity({ name: "x", type: "concept" })
    upsertEntity({ name: "y", type: "concept" })
    upsertRelation({ source: "x", target: "y", type: "likes", weight: 1.5 })

    const paths = traverseGraph("x")
    expect(paths).toHaveLength(1)
  })

  test("creates distinct relations for different types", () => {
    upsertEntity({ name: "p", type: "concept" })
    upsertEntity({ name: "q", type: "concept" })
    upsertRelation({ source: "p", target: "q", type: "calls" })
    upsertRelation({ source: "p", target: "q", type: "depends_on" })

    const paths = traverseGraph("p")
    expect(paths).toHaveLength(2)
  })
})

describe("boostEntityConfidence", () => {
  test("adds delta to confidence", () => {
    upsertEntity({ name: "boost_me", type: "concept" })
    boostEntityConfidence("boost_me", 0.2)
    expect(queryEntity("boost_me")!.confidence).toBeCloseTo(0.7)
  })

  test("caps confidence at 1.0", () => {
    upsertEntity({ name: "cap_boost", type: "concept" })
    boostEntityConfidence("cap_boost", 2.0)
    expect(queryEntity("cap_boost")!.confidence).toBe(1.0)
  })

  test("upgrades tier to persistent when confidence >= 0.8", () => {
    upsertEntity({ name: "upgrade_boost", type: "concept" })
    boostEntityConfidence("upgrade_boost", 0.5)
    const entity = queryEntity("upgrade_boost")
    expect(entity!.confidence).toBe(1.0)
    expect(entity!.tier).toBe("persistent")
  })

  test("does nothing for non-existent entity", () => {
    boostEntityConfidence("nope", 0.5)
    expect(queryEntity("nope")).toBeUndefined()
  })
})

describe("decayLowConfidence", () => {
  function forceAge(name: string, daysOld: number, confidence?: number) {
    const age = Date.now() - daysOld * 24 * 60 * 60 * 1000
    const updates: Record<string, unknown> = { updated_at: age }
    if (confidence !== undefined) updates.confidence = confidence
    Database.use((db) => db.update(EntityTable).set(updates).where(eq(EntityTable.name, name)).run())
  }

  test("decays short_term entities not updated in 3 days", () => {
    upsertEntity({ name: "old_entity", type: "concept", confidence: 0.5 })
    forceAge("old_entity", 5)

    const result = decayLowConfidence()
    expect(result.pruned).toBe(0)

    const entity = queryEntity("old_entity")
    expect(entity).toBeDefined()
    expect(entity!.confidence).toBeCloseTo(0.4)
  })

  test("prunes entities at 0 confidence", () => {
    upsertEntity({ name: "prune_me", type: "concept" })
    forceAge("prune_me", 5, 0)

    const result = decayLowConfidence()
    expect(result.pruned).toBe(1)
    expect(queryEntity("prune_me")).toBeUndefined()
  })

  test("does not affect persistent tier entities", () => {
    upsertEntity({ name: "persistent_entity", type: "concept", tier: "persistent" })
    forceAge("persistent_entity", 10)

    decayLowConfidence()
    const entity = queryEntity("persistent_entity")
    expect(entity).toBeDefined()
    expect(entity!.confidence).toBe(0.5)
  })

  test("does not decay entities updated recently", () => {
    upsertEntity({ name: "recent", type: "concept" })

    decayLowConfidence()
    expect(queryEntity("recent")!.confidence).toBe(0.5)
  })
})

describe("traverseGraph", () => {
  test("returns empty array for entity with no relations", () => {
    upsertEntity({ name: "isolated", type: "concept" })
    const paths = traverseGraph("isolated")
    expect(paths).toEqual([])
  })

  test("traverses two levels deep by default", () => {
    upsertRelation({ source: "a", target: "b", type: "depends_on" })
    upsertRelation({ source: "b", target: "c", type: "depends_on" })

    const paths = traverseGraph("a")
    expect(paths).toHaveLength(2)
    expect(paths[0].target_name).toBe("b")
    expect(paths[0].depth).toBe(1)
    expect(paths[1].target_name).toBe("c")
    expect(paths[1].depth).toBe(2)
  })

  test("traverses to specified depth", () => {
    upsertRelation({ source: "a", target: "b", type: "depends_on" })
    upsertRelation({ source: "b", target: "c", type: "depends_on" })
    upsertRelation({ source: "c", target: "d", type: "depends_on" })

    const paths = traverseGraph("a", { depth: 3 })
    expect(paths).toHaveLength(3)
    expect(paths[0].target_name).toBe("b")
    expect(paths[0].depth).toBe(1)
    expect(paths[1].target_name).toBe("c")
    expect(paths[1].depth).toBe(2)
    expect(paths[2].target_name).toBe("d")
    expect(paths[2].depth).toBe(3)
  })

  test("clamps depth to max 5", () => {
    // Build a chain a -> b -> c -> d -> e -> f
    const names = ["a", "b", "c", "d", "e", "f"]
    for (let i = 0; i < names.length - 1; i++) {
      upsertRelation({ source: names[i], target: names[i + 1], type: "chain" })
    }

    const paths = traverseGraph("a", { depth: 100 })
    expect(paths).toHaveLength(5) // clamped to 5
  })

  test("filters by relation type", () => {
    upsertRelation({ source: "x", target: "y", type: "calls" })
    upsertRelation({ source: "x", target: "z", type: "depends_on" })

    const paths = traverseGraph("x", { relation: "calls" })
    expect(paths).toHaveLength(1)
    expect(paths[0].target_name).toBe("y")
    expect(paths[0].relation_type).toBe("calls")
  })
})
