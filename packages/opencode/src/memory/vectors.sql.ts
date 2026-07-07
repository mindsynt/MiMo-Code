import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core"

export const ChunkTable = sqliteTable(
  "memory_chunk",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    chunk_text: text().notNull(),
    entity_id: integer(),
    source: text().notNull().default("conversation"),
    tier: text().notNull().default("short_term"),
    ttl: integer(),
    created_at: integer().notNull(),
    last_accessed: integer(),
  },
  (table) => [index("idx_memory_chunk_entity").on(table.entity_id), index("idx_memory_chunk_tier").on(table.tier)],
)

export const VectorTable = sqliteTable("memory_vector", {
  id: integer().primaryKey({ autoIncrement: true }),
  chunk_id: integer()
    .notNull()
    .unique()
    .references(() => ChunkTable.id, { onDelete: "cascade" }),
  embedding: blob().notNull(),
  created_at: integer().notNull(),
})
