import { describe, expect, test } from "bun:test"

describe("reflection", () => {
  test("module can be imported", async () => {
    const mod = await import("../../src/memory/reflection")
    expect(typeof mod.runReflection).toBe("function")
  })

  test("runReflection executes without error", async () => {
    const { runReflection } = await import("../../src/memory/reflection")
    await expect(runReflection()).resolves.toBeUndefined()
  })
})
