import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import { Database } from "../../src/storage"
import { ProfileTable } from "../../src/memory/profile.sql"
import {
  upsertPreference,
  getPreference,
  listPreferences,
  listActiveProfile,
  decayAndPrune,
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
    tier TEXT DEFAULT 'ephemeral' NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
})

afterEach(() => {
  Database.use((db) => db.delete(ProfileTable).run())
})

describe("upsertPreference", () => {
  test("creates new preference with tier from confidence", () => {
    upsertPreference({
      key: "runtime",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.7,
      source: "user_said",
      tier: "ephemeral",
    })
    const p = getPreference("runtime")
    expect(p).toBeDefined()
    expect(p!.value).toBe("bun")
    expect(p!.confidence).toBe(0.7)
    // 0.7 >= 0.6 → stable
    expect(p!.tier).toBe("stable")
  })

  test("high confidence promotes to core", () => {
    upsertPreference({
      key: "pkg_mgr",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.95,
      source: "user_said",
      tier: "ephemeral",
    })
    expect(getPreference("pkg_mgr")!.tier).toBe("core")
  })

  test("accumulates confidence and promotes tier", () => {
    upsertPreference({
      key: "pkg_mgr",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.6,
      source: "user_said",
      tier: "ephemeral",
    })
    expect(getPreference("pkg_mgr")!.tier).toBe("stable")
    upsertPreference({
      key: "pkg_mgr",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.6,
      source: "user_said",
      tier: "ephemeral",
    })
    const p = getPreference("pkg_mgr")
    expect(p!.confidence).toBeCloseTo(0.9) // 0.6 + 0.6*0.5 = 0.9
    expect(p!.tier).toBe("core") // promoted to core
  })

  test("caps confidence at 1.0", () => {
    upsertPreference({
      key: "always",
      value: "x",
      category: "explicit_preference",
      confidence: 2.0,
      source: "test",
      tier: "ephemeral",
    })
    expect(getPreference("always")!.confidence).toBe(1.0)
  })
})

describe("listPreferences", () => {
  test("lists all or filtered by category", () => {
    upsertPreference({
      key: "a",
      value: "1",
      category: "explicit_preference",
      confidence: 0.5,
      source: "t",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "b",
      value: "2",
      category: "inferred_pattern",
      confidence: 0.5,
      source: "t",
      tier: "ephemeral",
    })
    expect(listPreferences()).toHaveLength(2)
    expect(listPreferences("explicit_preference")).toHaveLength(1)
  })
})

describe("listActiveProfile", () => {
  test("only returns core and stable preferences", () => {
    upsertPreference({
      key: "core_k",
      value: "c",
      category: "explicit_preference",
      confidence: 0.95,
      source: "t",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "stable_k",
      value: "s",
      category: "explicit_preference",
      confidence: 0.7,
      source: "t",
      tier: "ephemeral",
    })
    upsertPreference({
      key: "eph_k",
      value: "e",
      category: "explicit_preference",
      confidence: 0.3,
      source: "t",
      tier: "ephemeral",
    })
    const active = listActiveProfile()
    expect(active.map((p) => p.key).sort()).toEqual(["core_k", "stable_k"])
  })
})

describe("decayAndPrune", () => {
  test("does not touch core items", () => {
    upsertPreference({
      key: "core_k",
      value: "c",
      category: "explicit_preference",
      confidence: 0.95,
      source: "t",
      tier: "ephemeral",
    })
    expect(getPreference("core_k")!.tier).toBe("core")
    // decayAndPrune should not affect core items
    decayAndPrune()
    expect(getPreference("core_k")).toBeDefined()
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
