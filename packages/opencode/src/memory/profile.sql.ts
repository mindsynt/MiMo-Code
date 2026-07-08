import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const ProfileTable = sqliteTable("memory_user_profile", {
  id: integer().primaryKey({ autoIncrement: true }),
  key: text().notNull().unique(),
  value: text().notNull(),
  category: text().notNull(),
  confidence: real().notNull().default(0.5),
  source: text().notNull().default("conversation"),
  tier: text().notNull().default("ephemeral"), // ephemeral | stable | core
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})
