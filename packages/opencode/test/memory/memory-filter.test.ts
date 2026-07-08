import { describe, expect, test } from "bun:test"
import { filterMemory, type FilterableMemory } from "../../src/memory/filter"

describe("filterMemory — Layer 1: Persistence", () => {
  const items: FilterableMemory[] = [
    { type: "rule", tier: "core", key: "r1", text: "core rule", score: 0.9, structured: true },
    { type: "rule", tier: "stable", key: "r2", text: "stable rule", score: 0.7, structured: true },
    { type: "rule", tier: "ephemeral", key: "r3", text: "ephemeral rule", score: 0.4, structured: true },
    { type: "profile", tier: "core", key: "p1", text: "core pref", score: 0.95, structured: true },
  ]

  test("filters out ephemeral by default", () => {
    const result = filterMemory(items)
    expect(result).toHaveLength(3) // core + stable + core profile
    expect(result.every((i) => i.tier !== "ephemeral")).toBe(true)
  })

  test("includeEphemeral=true keeps ephemeral items", () => {
    const result = filterMemory(items, { includeEphemeral: true })
    expect(result).toHaveLength(4)
  })
})

describe("filterMemory — Layer 2: Structure", () => {
  test("deduplicates by key, keeping structured version", () => {
    const items: FilterableMemory[] = [
      { type: "rule", key: "same_key", text: "structured version", structured: true, score: 0.9 },
      { type: "chunk", key: "same_key", text: "unstructured version", structured: false, score: 0.7 },
    ]
    const result = filterMemory(items)
    expect(result).toHaveLength(1)
    expect(result[0].structured).toBe(true)
    expect(result[0].text).toBe("structured version")
  })

  test("prioritizes structured items over unstructured", () => {
    const items: FilterableMemory[] = [
      { type: "chunk", text: "random chunk", structured: false, score: 0.9 },
      { type: "rule", text: "important rule", structured: true, score: 0.5 },
    ]
    const result = filterMemory(items)
    expect(result[0].structured).toBe(true) // rule before chunk despite lower score
    expect(result[1].structured).toBe(false)
  })
})

describe("filterMemory — Layer 3: Personalization", () => {
  test("boosts items relating to current entities", () => {
    const items: FilterableMemory[] = [
      { type: "rule", text: "snake_case for session.sql", structured: true, score: 0.5, relatesTo: ["session.sql"] },
      { type: "rule", text: "unrelated rule", structured: true, score: 0.5, relatesTo: [] },
    ]
    const result = filterMemory(items, { currentEntities: ["session.sql"] })
    expect(result[0].text).toBe("snake_case for session.sql")
    expect(result[0].score).toBeGreaterThan(result[1].score!)
  })
})

describe("filterMemory — Combined", () => {
  test("full pipeline: persistence → structure → personalization", () => {
    const items: FilterableMemory[] = [
      { type: "chunk", tier: "ephemeral", key: "noise", text: "noise chunk", structured: false, score: 0.9 },
      {
        type: "rule",
        tier: "core",
        key: "r1",
        text: "core rule applies to session.sql",
        structured: true,
        score: 0.9,
        relatesTo: ["session.sql"],
      },
      { type: "rule", tier: "stable", key: "r2", text: "stable rule", structured: true, score: 0.7 },
      { type: "profile", tier: "ephemeral", key: "p1", text: "ephemeral pref", structured: true, score: 0.3 },
    ]
    const result = filterMemory(items, { currentEntities: ["session.sql"] })
    // Ephemeral items filtered out → 2 remain (core rule + stable rule)
    expect(result).toHaveLength(2)
    // Core rule about session.sql should rank first (personalization boost)
    expect(result[0].text).toContain("session.sql")
  })
})
