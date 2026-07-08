import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// 规则溯源表：记录每一条规则是从哪条消息提取的
export const RuleProvenanceTable = sqliteTable(
  "memory_rule_provenance",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    rule_name: text().notNull(),
    session_id: text().notNull(),
    message_id: text().notNull(),
    extracted_text: text(),
    created_at: integer().notNull(),
  },
  (table) => [index("idx_rule_prov_rule").on(table.rule_name), index("idx_rule_prov_session").on(table.session_id)],
)
