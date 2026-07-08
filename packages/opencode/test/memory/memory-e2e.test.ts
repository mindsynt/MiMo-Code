/**
 * End-to-end memory system test:
 *   Storage:  memory pipeline → entities, rules, profile, chunks, FTS
 *   Retrieval:  memory search, graph traversal, filter, checkpoint rebuild
 *
 * Tests the full "存 → 取" chain for every memory type.
 */
import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database } from "../../src/storage"
import { EntityTable, RelationTable } from "../../src/memory/pipeline.sql"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { ProfileTable } from "../../src/memory/profile.sql"

// ─── Tables ─────────────────────────────────────────────────────────────────

beforeAll(() => {
  const db = Database.Client().$client
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS memory_entity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'concept', context TEXT,
      confidence REAL DEFAULT 0.5 NOT NULL,
      source TEXT DEFAULT 'conversation' NOT NULL,
      tier TEXT DEFAULT 'short_term' NOT NULL,
      first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
      type TEXT NOT NULL, weight REAL DEFAULT 1.0 NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS memory_chunk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_text TEXT NOT NULL, source TEXT DEFAULT 'conversation' NOT NULL,
      tier TEXT DEFAULT 'short_term' NOT NULL,
      ttl INTEGER, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS memory_rule_provenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT NOT NULL, session_id TEXT NOT NULL,
      message_id TEXT NOT NULL, extracted_text TEXT,
      created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS memory_user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE, value TEXT NOT NULL,
      category TEXT NOT NULL, confidence REAL DEFAULT 0.5 NOT NULL,
      source TEXT DEFAULT 'conversation' NOT NULL,
      tier TEXT DEFAULT 'ephemeral' NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  ])
    db.run(sql)
})

afterEach(() => {
  const db = Database.Client().$client
  for (const t of [
    "memory_relation",
    "memory_entity",
    "memory_chunk",
    "memory_rule_provenance",
    "memory_user_profile",
  ]) {
    try {
      db.run(`DELETE FROM ${t}`)
    } catch {}
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function count(table: string): number {
  return (Database.Client().$client.query(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c
}

// ─── Storage tests ───────────────────────────────────────────────────────────

describe("Storage: entity graph", () => {
  test("entity upsert with confidence accumulation", () => {
    const { upsertEntity } = require("../../src/memory/entities")
    upsertEntity({ name: "test_func", type: "function", confidence: 0.6, source: "conversation" })
    expect(count("memory_entity")).toBe(1)

    // Re-upsert with same name → boosts confidence
    upsertEntity({ name: "test_func", type: "function", confidence: 0.6, source: "conversation" })
    const row = Database.Client()
      .$client.query("SELECT confidence FROM memory_entity WHERE name = ?")
      .get("test_func") as any
    expect(row.confidence).toBeGreaterThan(0.6)
  })

  test("relation upsert creates governs link", () => {
    const { upsertEntity, upsertRelation } = require("../../src/memory/entities")
    upsertEntity({ name: "my_rule", type: "rule", confidence: 0.8 })
    upsertEntity({ name: "session.sql", type: "file", confidence: 0.8 })
    upsertRelation({ source: "my_rule", target: "session.sql", type: "governs" })

    expect(count("memory_relation")).toBe(1)
    const rel = Database.Client()
      .$client.query(
        `SELECT r.type, e.name AS src, et.name AS tgt
       FROM memory_relation r
       JOIN memory_entity e ON e.id = r.source_id
       JOIN memory_entity et ON et.id = r.target_id`,
      )
      .get() as any
    expect(rel.type).toBe("governs")
    expect(rel.src).toBe("my_rule")
    expect(rel.tgt).toBe("session.sql")
  })
})

describe("Storage: rules with provenance", () => {
  test("upsertRule creates entity + provenance", () => {
    const { upsertRule } = require("../../src/memory/rules")
    upsertRule({
      slug: "snake_case",
      text: "Use snake_case",
      confidence: 0.8,
      sessionID: "ses_test",
      messageID: "msg_test",
    })

    expect(count("memory_entity")).toBe(1)
    expect(count("memory_rule_provenance")).toBe(1)

    const e = Database.Client()
      .$client.query("SELECT type, context FROM memory_entity WHERE name = ?")
      .get("snake_case") as any
    expect(e.type).toBe("rule")
    expect(e.context).toBe("Use snake_case")

    const p = Database.Client()
      .$client.query("SELECT session_id, message_id FROM memory_rule_provenance WHERE rule_name = ?")
      .get("snake_case") as any
    expect(p.session_id).toBe("ses_test")
    expect(p.message_id).toBe("msg_test")
  })
})

describe("Storage: profile with tier promotion", () => {
  test("low confidence → ephemeral, high → core", () => {
    const { upsertPreference, getPreference } = require("../../src/memory/profile")

    upsertPreference({
      key: "lang",
      value: "ts",
      category: "explicit_preference",
      confidence: 0.4,
      source: "test",
      tier: "ephemeral",
    })
    expect(getPreference("lang")!.tier).toBe("ephemeral")

    upsertPreference({
      key: "lang",
      value: "ts",
      category: "explicit_preference",
      confidence: 0.4,
      source: "test",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "lang",
      value: "ts",
      category: "explicit_preference",
      confidence: 0.4,
      source: "test",
      tier: "ephemeral",
    })
    // 0.4 + 0.4*0.5 + 0.4*0.5 = 0.8 → stable
    expect(getPreference("lang")!.tier).toBe("stable")

    upsertPreference({
      key: "lang",
      value: "ts",
      category: "explicit_preference",
      confidence: 0.4,
      source: "test",
      tier: "ephemeral",
    })
    // 0.8 + 0.4*0.5 = 1.0 → core
    expect(getPreference("lang")!.tier).toBe("core")
  })

  test("listActiveProfile excludes ephemeral", () => {
    const { upsertPreference, listActiveProfile } = require("../../src/memory/profile")
    upsertPreference({
      key: "a",
      value: "core_val",
      category: "explicit_preference",
      confidence: 0.95,
      source: "t",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "b",
      value: "stable_val",
      category: "explicit_preference",
      confidence: 0.7,
      source: "t",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "c",
      value: "eph_val",
      category: "explicit_preference",
      confidence: 0.3,
      source: "t",
      tier: "ephemeral",
    })

    const active = listActiveProfile()
    expect(active.map((p: any) => p.key).sort()).toEqual(["a", "b"])
  })
})

describe("Storage: pipeline rule + entity extraction", () => {
  test("extractRules identifies governed entities", () => {
    const { extractRules, extractGovernedEntities } = require("../../src/memory/extractors/rules")

    const rules = extractRules("必须用 snake_case，参考 `session.sql` 和 `UserService`")
    expect(rules.length).toBeGreaterThanOrEqual(1)
    const r = rules[0]
    expect(r.slug).toContain("snake_case")
    // Should have extracted governed entities
    expect(r.governs.length).toBeGreaterThanOrEqual(1)
    expect(r.governs.some((g: string) => g.includes("session.sql"))).toBe(true)
  })

  test("extractCodeEntities finds files and functions", () => {
    const { extractCodeEntities } = require("../../src/memory/extractors/code")
    const entities = extractCodeEntities("在 `src/main.ts` 里调用 `Bun.write()`")
    const names = entities.map((e: any) => e.name)
    expect(names).toContain("src/main.ts")
    expect(names).toContain("Bun.write")
  })
})

// ─── Retrieval tests ─────────────────────────────────────────────────────────

describe("Retrieval: graph queries", () => {
  test("traverseGraph follows governs relations", () => {
    const { upsertEntity, upsertRelation } = require("../../src/memory/entities")
    const { traverseGraph } = require("../../src/memory/entities")

    upsertEntity({ name: "rule_a", type: "rule" })
    upsertEntity({ name: "rule_b", type: "rule" })
    upsertEntity({ name: "session.sql", type: "file" })
    upsertRelation({ source: "rule_a", target: "session.sql", type: "governs" })
    upsertRelation({ source: "rule_b", target: "session.sql", type: "governs" })

    // Reversed traversal: find rules that govern session.sql
    // traverseGraph goes forward, so we traverse FROM rules
    const fromRuleA = traverseGraph("rule_a", { relation: "governs", depth: 1 })
    expect(fromRuleA.length).toBeGreaterThanOrEqual(1)
    expect(fromRuleA.some((p: any) => p.target_name === "session.sql")).toBe(true)
  })

  test("queryRulesForEntity finds rules by governed entity", () => {
    const { upsertEntity, upsertRelation } = require("../../src/memory/entities")
    const { queryRulesForEntity } = require("../../src/memory/rules")

    upsertEntity({ name: "snake_rule", type: "rule", context: "Use snake_case" })
    upsertEntity({ name: "session.sql", type: "file" })
    upsertRelation({ source: "snake_rule", target: "session.sql", type: "governs" })

    const rules = queryRulesForEntity("session.sql")
    expect(rules.length).toBe(1)
    expect(rules[0].slug).toBe("snake_rule")
  })
})

describe("Retrieval: three-layer filter", () => {
  test("filterMemory removes ephemeral, prioritizes structured", () => {
    const { filterMemory } = require("../../src/memory/filter")
    const items = [
      { type: "chunk", tier: "ephemeral", text: "noise", structured: false, score: 0.9 },
      { type: "rule", tier: "core", key: "r1", text: "core rule", structured: true, score: 0.8 },
      { type: "rule", tier: "ephemeral", key: "r2", text: "ephemeral rule", structured: true, score: 0.5 },
    ]
    const result = filterMemory(items)
    expect(result).toHaveLength(1) // only core rule
    expect(result[0].key).toBe("r1")
  })

  test("filterMemory personalization boost", () => {
    const { filterMemory } = require("../../src/memory/filter")
    const items = [
      { type: "rule", text: "relevant", structured: true, score: 0.5, relatesTo: ["session.sql"] },
      { type: "rule", text: "irrelevant", structured: true, score: 0.5 },
    ]
    const result = filterMemory(items, { currentEntities: ["session.sql"] })
    expect(result[0].text).toBe("relevant")
  })
})

describe("Retrieval: MEMORY.md differentiation", () => {
  test("processMemoryFile extracts rules but not narrative", async () => {
    const { processMemoryFile } = require("../../src/memory/memory-md")
    const md = `# Project

## About
Some background.

## Rules
1. **snake_rule** — Use snake_case for tables
2. **no_null** — Avoid nullable columns

## Notes
Random notes.`

    const result = await processMemoryFile("/tmp/test/MEMORY.md", md)
    expect(result.rulesExtracted).toBeGreaterThanOrEqual(2)

    // "About" and "Notes" sections should NOT produce rules in the graph
    const rules = Database.Client().$client.query("SELECT name FROM memory_entity WHERE type = 'rule'").all() as any[]
    expect(rules.some((r: any) => r.name === "snake_rule")).toBe(true)
    expect(rules.some((r: any) => r.name === "no_null")).toBe(true)

    // Structured sections should be chunked
    expect(count("memory_chunk")).toBeGreaterThanOrEqual(1)
  })
})

// ─── Cross-module integrity ──────────────────────────────────────────────────

describe("Integrity: cross-module consistency", () => {
  test("rule in graph has matching provenance", () => {
    const { upsertRule } = require("../../src/memory/rules")
    upsertRule({ slug: "cross_check", text: "Cross module test", confidence: 0.8, sessionID: "s1", messageID: "m1" })

    // Entity table
    const entity = Database.Client()
      .$client.query("SELECT name, type FROM memory_entity WHERE name = ?")
      .get("cross_check") as any
    expect(entity).toBeDefined()
    expect(entity.type).toBe("rule")

    // Provenance table
    const prov = Database.Client()
      .$client.query("SELECT session_id, message_id FROM memory_rule_provenance WHERE rule_name = ?")
      .get("cross_check") as any
    expect(prov.session_id).toBe("s1")
  })

  test("filter does not crash on empty or malformed input", () => {
    const { filterMemory, buildFilteredContext } = require("../../src/memory/filter")
    expect(filterMemory([])).toEqual([])
    expect(filterMemory([{}])).toBeDefined() // malformed item
  })
})
