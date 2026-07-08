import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database } from "../../src/storage"
import { ProfileTable } from "../../src/memory/profile.sql"
import {
  upsertPreference,
  getPreference,
  listPreferences,
  decayLowConfidencePreferences,
} from "../../src/memory/profile"
import { classifyPersonal } from "../../src/memory/classification"

// Create tables
beforeAll(() => {
  const db = Database.Client().$client
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
  Database.use((db) => db.delete(ProfileTable).run())
})

describe("upsertPreference", () => {
  test("creates new preference", () => {
    upsertPreference({
      key: "runtime",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.7,
      source: "user_said",
    })
    const p = getPreference("runtime")
    expect(p).toBeDefined()
    expect(p!.value).toBe("bun")
    expect(p!.confidence).toBe(0.7)
  })

  test("accumulates confidence on re-insert", () => {
    upsertPreference({
      key: "pkg_mgr",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.6,
      source: "user_said",
    })
    upsertPreference({
      key: "pkg_mgr",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.6,
      source: "user_said",
    })
    const p = getPreference("pkg_mgr")
    expect(p!.confidence).toBeCloseTo(0.9) // 0.6 + 0.6*0.5 = 0.9
  })

  test("caps confidence at 1.0", () => {
    upsertPreference({ key: "always", value: "x", category: "explicit_preference", confidence: 2.0, source: "test" })
    expect(getPreference("always")!.confidence).toBe(1.0)
  })
})

describe("listPreferences", () => {
  test("lists all or filtered by category", () => {
    upsertPreference({ key: "a", value: "1", category: "explicit_preference", confidence: 0.5, source: "t" })
    upsertPreference({ key: "b", value: "2", category: "inferred_pattern", confidence: 0.5, source: "t" })
    expect(listPreferences()).toHaveLength(2)
    expect(listPreferences("explicit_preference")).toHaveLength(1)
  })
})

describe("classifyPersonal", () => {
  test("extracts explicit tool preference", () => {
    const r = classifyPersonal("我喜欢用 Bun")
    expect(r.some((x) => x.key === "preferred_tool" && x.value === "Bun")).toBe(true)
  })
  test("extracts negative preference", () => {
    const r = classifyPersonal("不要用 npm")
    expect(r.some((x) => x.key === "disliked_tool" && x.value === "npm")).toBe(true)
  })
  test("returns empty for neutral text", () => {
    expect(classifyPersonal("今天天气不错")).toEqual([])
  })
})
