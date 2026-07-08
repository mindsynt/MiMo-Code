import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database } from "../../src/storage"
import { EntityTable } from "../../src/memory/pipeline.sql"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { processMemoryFile } from "../../src/memory/memory-md"

// Set up memory tables
beforeAll(() => {
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'concept',
    context TEXT,
    confidence REAL DEFAULT 0.5 NOT NULL,
    source TEXT DEFAULT 'conversation' NOT NULL,
    tier TEXT DEFAULT 'short_term' NOT NULL,
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_relation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES memory_entity(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    weight REAL DEFAULT 1.0 NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text TEXT NOT NULL,
    source TEXT DEFAULT 'conversation' NOT NULL,
    tier TEXT DEFAULT 'short_term' NOT NULL,
    ttl INTEGER,
    created_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_rule_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    extracted_text TEXT,
    created_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  const db = Database.Client().$client
  db.run("DELETE FROM memory_relation")
  db.run("DELETE FROM memory_entity")
  db.run("DELETE FROM memory_chunk")
  db.run("DELETE FROM memory_rule_provenance")
})

const TEST_MEMORY_MD = `# Project

## About
This is a web application project.

## Rules
1. **drizzle_snake_case** — Drizzle schema uses snake_case field names
2. **no_try_catch** — Avoid try/catch, use Effect instead

## Architecture Decisions
- **selected_effect** — Chose Effect over try/catch for error handling

## Notes
Some random notes.

## Conventions
- Always use const over let
- ternaries over if/else reassignment
`

describe("processMemoryFile", () => {
  test("extracts rules from structured sections", async () => {
    const result = await processMemoryFile("/tmp/test/MEMORY.md", TEST_MEMORY_MD)

    expect(result.rulesExtracted).toBeGreaterThanOrEqual(4)

    // Rules should be in the entity graph as type "rule"
    const db = Database.Client().$client
    const rules = db.query("SELECT * FROM memory_entity WHERE type = 'rule'").all() as any[]
    expect(rules.length).toBeGreaterThanOrEqual(4)
  })

  test("embeds structured sections as chunks", async () => {
    const before = Database.Client().$client.query("SELECT COUNT(*) as c FROM memory_chunk").get() as any
    await processMemoryFile("/tmp/test/MEMORY.md", TEST_MEMORY_MD)
    const after = Database.Client().$client.query("SELECT COUNT(*) as c FROM memory_chunk").get() as any
    expect(after.c - before.c).toBeGreaterThanOrEqual(3)
  })

  test("leaves unstructured sections alone (no rules from About/Notes)", async () => {
    await processMemoryFile("/tmp/test/MEMORY.md", TEST_MEMORY_MD)

    const rules = Database.Client().$client.query("SELECT name FROM memory_entity WHERE type = 'rule'").all() as {
      name: string
    }[]

    const ruleNames = rules.map((r) => r.name)
    expect(ruleNames).toContain("drizzle_snake_case")
    expect(ruleNames).toContain("no_try_catch")
    expect(ruleNames).toContain("selected_effect")
    // Conventions section also produces rules
    expect(ruleNames.some((n) => n.includes("const"))).toBe(true)
  })
})
