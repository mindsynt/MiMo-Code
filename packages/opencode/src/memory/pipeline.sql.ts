import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core"

// 实体表
export const EntityTable = sqliteTable("memory_entity", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  type: text().notNull(), // function | api | config | concept | user_pref | file
  context: text(), // 简短说明
  confidence: real().notNull().default(0.5),
  source: text().notNull().default("conversation"), // conversation | reflection | code_analysis
  tier: text().notNull().default("short_term"), // persistent | short_term
  first_seen: integer().notNull(),
  updated_at: integer().notNull(),
})

// 关系表
export const RelationTable = sqliteTable(
  "memory_relation",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    source_id: integer()
      .notNull()
      .references(() => EntityTable.id, { onDelete: "cascade" }),
    target_id: integer()
      .notNull()
      .references(() => EntityTable.id, { onDelete: "cascade" }),
    type: text().notNull(), // depends_on | implements | configures | calls | prefers | part_of | similar_to | rejects
    weight: real().notNull().default(1.0),
    first_seen: integer().notNull(),
    last_seen: integer().notNull(),
  },
  (table) => [
    uniqueIndex("idx_memory_rel_pair").on(table.source_id, table.target_id, table.type),
    index("idx_memory_rel_source").on(table.source_id),
    index("idx_memory_rel_target").on(table.target_id),
    index("idx_memory_rel_type").on(table.type),
  ],
)

// 分类日志表（调试+监控）
export const ClassifyLogTable = sqliteTable("memory_classify_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  session_id: text().notNull(),
  message_id: text().notNull(),
  tier: text().notNull(),
  entities_found: text(), // JSON array
  processing_ms: integer(),
  created_at: integer().notNull(),
})
