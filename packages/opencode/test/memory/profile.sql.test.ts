import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { getTableName } from "drizzle-orm"
import { ProfileTable } from "../../src/memory/profile.sql"

describe("memory user profile schema", () => {
  test("ProfileTable has correct table name", () => {
    expect(getTableName(ProfileTable)).toBe("memory_user_profile")
  })

  test("ProfileTable has all required columns", () => {
    expect(ProfileTable.id).toBeDefined()
    expect(ProfileTable.key).toBeDefined()
    expect(ProfileTable.value).toBeDefined()
    expect(ProfileTable.category).toBeDefined()
    expect(ProfileTable.confidence).toBeDefined()
    expect(ProfileTable.source).toBeDefined()
    expect(ProfileTable.created_at).toBeDefined()
    expect(ProfileTable.updated_at).toBeDefined()
  })

  test("ProfileTable can be created in SQLite", () => {
    const bunDb = new Database(":memory:")

    bunDb.run(`
      CREATE TABLE memory_user_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL DEFAULT 0.5 NOT NULL,
        source TEXT DEFAULT 'conversation' NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    const row = bunDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_user_profile'")
      .get() as { name: string } | undefined
    expect(row).toBeTruthy()
    expect(row!.name).toBe("memory_user_profile")

    bunDb.close()
  })
})
