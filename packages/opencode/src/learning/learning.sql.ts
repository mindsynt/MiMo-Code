import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core"

export const LearningNodeTable = sqliteTable(
  "learning_node",
  {
    id: text().primaryKey(),
    label: text().notNull(),
    kind: text().notNull(), // "skill" | "memory"
    category: text().notNull().default(""),
    use_count: integer().notNull().default(0),
    state: text().notNull().default("active"),
    bundled: integer({ mode: "boolean" }).notNull().default(false),
    timestamp: integer(),
    memory_source: text(),
    fingerprint: text().notNull().default(""),
    last_built_at: integer().notNull(),
  },
  (table) => [index("learning_node_kind_idx").on(table.kind)],
)

export const LearningEdgeTable = sqliteTable(
  "learning_edge",
  {
    source: text()
      .notNull()
      .references(() => LearningNodeTable.id),
    target: text()
      .notNull()
      .references(() => LearningNodeTable.id),
    weight: real().notNull().default(0),
    edge_type: text().notNull().default("skill-skill"), // "skill-skill" | "memory-skill"
    last_built_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.target, table.edge_type] }),
    index("learning_edge_source_idx").on(table.source),
    index("learning_edge_target_idx").on(table.target),
  ],
)
