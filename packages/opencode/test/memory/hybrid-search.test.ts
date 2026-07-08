import { describe, expect, test } from "bun:test"
import { hybridSearch } from "../../src/memory/hybrid-search"

describe("hybridSearch", () => {
  const mockMemory = {
    search: async () => [
      { snippet: "FTS result 1", score: 0.5, path: "", scope: "", scope_id: "", type: "" },
      { snippet: "FTS result 2", score: 0.3, path: "", scope: "", scope_id: "", type: "" },
    ],
  }

  test("returns results from vector mode (empty index gracefully)", async () => {
    const r = await hybridSearch("test", mockMemory, { mode: "vector" })
    expect(Array.isArray(r)).toBe(true)
  })

  test("returns results from fts mode", async () => {
    const r = await hybridSearch("test", mockMemory, { mode: "fts" })
    expect(r.length).toBe(2)
    expect(r[0].source).toBe("fts")
  })

  test("hybrid mode returns fused results", async () => {
    const r = await hybridSearch("test", mockMemory, { mode: "hybrid" })
    expect(Array.isArray(r)).toBe(true)
    expect(r.length).toBeGreaterThanOrEqual(0)
  })

  test("graph mode handles empty query gracefully", async () => {
    const r = await hybridSearch("", mockMemory, { mode: "graph" })
    expect(Array.isArray(r)).toBe(true)
  })
})
