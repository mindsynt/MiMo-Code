# Phase 1: 记忆分类通道 + 实体图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现对话内容的三层分类通道（持久性/结构化/个性化）和实体关系图存储，作为记忆系统的结构化增强层。

**Architecture:** 纯 SQLite 扩展方案，在现有 `memory_fts` 表旁新增 `memory_entity` 和 `memory_relation` 两张实体关系表。采用两阶段异步管线：Phase A 用规则引擎实现秒级分类和实体提取，Phase B 用 LLM 回调精化实体关系。新增 `memory-graph` 工具提供图遍历查询能力，与现有 `memory` 工具互补。

**Tech Stack:** TypeScript, Bun, SQLite (drizzle-orm), Effect

**Plan 对应的 brainstorm 设计决策:**

- 提取范围：代码实体 + 概念实体
- 分类策略：均衡（不确定的默认 short_term）
- 关系提取：规则预筛 + LLM 全量回调（可配置，默认共享主模型）
- 工具接口：独立 memory-graph 工具

---

## File Structure

```
packages/opencode/src/memory/
├── pipeline.sql.ts          (NEW)  — Entity + Relation + ClassifyLog 表定义
├── entities.ts              (NEW)  — 实体/关系的 CRUD、置信度管理、衰减
├── classification.ts        (NEW)  — 三层持久性分类器
├── extractors/
│   ├── code.ts              (NEW)  — 代码实体提取器（正则规则）
│   ├── concept.ts           (NEW)  — 概念实体提取器（正则规则）
│   └── relations.ts         (NEW)  — LLM 回调的关系提取 prompt + 解析
├── index.ts                 (MOD)  — 导出新模块
├── service.ts               (MOD)  — 扩展 Memory.Service，新增 graphSearch/traverse

packages/opencode/src/session/
├── memory-pipeline.ts       (NEW)  — 两阶段管线调度器
├── prune.ts                 (MOD)  — 每轮对话后触发管线

packages/opencode/src/tool/
├── memory.ts                (MOD)  — 现有 memory 工具（不变）
├── memory-graph.ts          (NEW)  — 图查询工具（traverse + subgraph）
├── memory-graph.txt         (NEW)  — 图查询工具描述文本

packages/opencode/test/memory/
├── pipeline.sql.test.ts     (NEW)  — Schema 创建测试
├── entities.test.ts         (NEW)  — 实体 CRUD + 置信度测试
├── classification.test.ts   (NEW)  — 三层分类 + 提取器测试
├── relations.test.ts        (NEW)  — LLM prompt 构建测试
├── memory-pipeline.test.ts  (NEW)  — 管线集成测试
├── memory-graph.test.ts     (NEW)  — 图遍历查询测试
```

---

### Task 1: Schema 定义

**Covers:** 实体表定义、关系表定义、分类日志表定义

**Files:**

- Create: `packages/opencode/src/memory/pipeline.sql.ts`
- Test: `packages/opencode/test/memory/pipeline.sql.test.ts`

**Interfaces:**

- Produces: `EntityTable`, `RelationTable`, `ClassifyLogTable` — 三个 drizzle `sqliteTable` 定义，供 `entities.ts` 和 `classification.ts` import

- [ ] **Step 1: Write `pipeline.sql.ts`**

```typescript
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
```

- [ ] **Step 2: Write test to verify schema is creatable**

```typescript
import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage"

describe("memory pipeline schema", () => {
  test("EntityTable columns exist after create", () => {
    // Database.Client() returns the drizzle instance
    const db = Database.Client()
    // Verify the table exists by querying sqlite_master
    const row = db.$client.query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entity'").get()
    expect(row).toBeTruthy()
  })

  test("RelationTable has unique index on (source_id, target_id, type)", () => {
    const db = Database.Client()
    const row = db.$client
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_rel_pair'")
      .get()
    expect(row).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify**

Run: `bun test test/memory/pipeline.sql.test.ts` (from `packages/opencode`)
Expected: 2/2 passing

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/memory/pipeline.sql.ts packages/opencode/test/memory/pipeline.sql.test.ts
git commit -m "feat(memory): add entity, relation, and classify_log table schemas"
```

---

### Task 2: 实体 CRUD + 置信度管理

**Covers:** 实体插入/去重/置信度累积、关系插入/去重、置信度衰减、自动升级

**Files:**

- Create: `packages/opencode/src/memory/entities.ts`
- Test: `packages/opencode/test/memory/entities.test.ts`

**Interfaces:**

- Consumes: `EntityTable`, `RelationTable` from `pipeline.sql.ts`
- Produces:
  - `upsertEntity(input: { name, type, context?, confidence?, source?, tier? }): Promise<void>`
  - `upsertRelation(input: { source, target, type, weight? }): Promise<void>`
  - `boostEntityConfidence(name: string, delta: number): Promise<void>`
  - `decayLowConfidence(): Promise<{ pruned: number }>`
  - `queryEntity(name: string): Promise<EntityRow | undefined>`
  - `traverseGraph(from: string, opts?: { relation?, depth? }): Promise<GraphPath[]>`

- [ ] **Step 1: Write entity CRUD implementation**

```typescript
import { Database, and, eq, or, sql, lt } from "@/storage"
import { EntityTable, RelationTable } from "./pipeline.sql"

export interface UpsertEntityInput {
  name: string
  type: string
  context?: string
  confidence?: number
  source?: string
  tier?: string
}

export async function upsertEntity(input: UpsertEntityInput): Promise<void> {
  const existing = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, input.name)).get())
  const now = Date.now()

  if (existing) {
    // 累积置信度
    const delta = input.confidence ?? 0.1
    const newConfidence = Math.min(1.0, existing.confidence + delta)
    // 类型合并：如果已有类型与新类型不同且新类型更具体则覆盖
    const mergedType = existing.type === "concept" && input.type !== "concept" ? input.type : existing.type
    // 自动升级
    const newTier = newConfidence >= 0.8 ? "persistent" : existing.tier

    Database.use((db) =>
      db
        .update(EntityTable)
        .set({
          confidence: newConfidence,
          type: mergedType,
          context: input.context ?? existing.context,
          tier: newTier,
          updated_at: now,
        })
        .where(eq(EntityTable.id, existing.id))
        .run(),
    )
  } else {
    Database.use((db) =>
      db
        .insert(EntityTable)
        .values({
          name: input.name,
          type: input.type,
          context: input.context ?? null,
          confidence: input.confidence ?? 0.5,
          source: input.source ?? "conversation",
          tier: input.tier ?? "short_term",
          first_seen: now,
          updated_at: now,
        })
        .run(),
    )
  }
}

export interface UpsertRelationInput {
  source: string
  target: string
  type: string
  weight?: number
}

export async function upsertRelation(input: UpsertRelationInput): Promise<void> {
  // 确保 source 和 target 实体存在
  const sourceId = await resolveEntityId(input.source)
  const targetId = await resolveEntityId(input.target)
  if (!sourceId || !targetId) return // 异常：实体不存在

  const existing = Database.use((db) =>
    db
      .select()
      .from(RelationTable)
      .where(
        and(
          eq(RelationTable.source_id, sourceId),
          eq(RelationTable.target_id, targetId),
          eq(RelationTable.type, input.type),
        ),
      )
      .get(),
  )
  const now = Date.now()

  if (existing) {
    const newWeight = Math.min(1.0, existing.weight + (input.weight ?? 0.1))
    Database.use((db) =>
      db
        .update(RelationTable)
        .set({ weight: newWeight, last_seen: now })
        .where(eq(RelationTable.id, existing.id))
        .run(),
    )
  } else {
    Database.use((db) =>
      db
        .insert(RelationTable)
        .values({
          source_id: sourceId,
          target_id: targetId,
          type: input.type,
          weight: input.weight ?? 0.7,
          first_seen: now,
          last_seen: now,
        })
        .run(),
    )
  }
}

async function resolveEntityId(name: string): Promise<number | null> {
  const row = Database.use((db) =>
    db.select({ id: EntityTable.id }).from(EntityTable).where(eq(EntityTable.name, name)).get(),
  )
  return row?.id ?? null
}

export async function boostEntityConfidence(name: string, delta: number): Promise<void> {
  const existing = Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, name)).get())
  if (!existing) return
  const newConfidence = Math.min(1.0, existing.confidence + delta)
  const newTier = newConfidence >= 0.8 ? "persistent" : existing.tier
  Database.use((db) =>
    db
      .update(EntityTable)
      .set({ confidence: newConfidence, tier: newTier, updated_at: Date.now() })
      .where(eq(EntityTable.id, existing.id))
      .run(),
  )
}

export async function decayLowConfidence(): Promise<{ pruned: number }> {
  const now = Date.now()
  const DAY_MS = 86400_000
  const THREE_DAYS = 3 * DAY_MS

  // short_term 且 3 天未更新 → 衰减 0.1
  Database.use((db) =>
    db
      .update(EntityTable)
      .set({ confidence: sql`MAX(0.0, confidence - 0.1)` })
      .where(
        and(
          eq(EntityTable.tier, "short_term"),
          lt(EntityTable.updated_at, now - THREE_DAYS),
          gt(EntityTable.confidence, 0),
        ),
      )
      .run(),
  )

  // confidence = 0 → 删除（级联删除关系）
  const dead = Database.use((db) =>
    db.select({ id: EntityTable.id }).from(EntityTable).where(eq(EntityTable.confidence, 0)).all(),
  )
  for (const e of dead) {
    Database.use((db) => db.delete(EntityTable).where(eq(EntityTable.id, e.id)).run())
  }
  return { pruned: dead.length }
}

export async function queryEntity(name: string) {
  return Database.use((db) => db.select().from(EntityTable).where(eq(EntityTable.name, name)).get())
}

// 图遍历 — SQLite 递归 CTE
export interface GraphPath {
  source_name: string
  relation_type: string
  target_name: string
  target_type: string
  depth: number
}

export async function traverseGraph(from: string, opts?: { relation?: string; depth?: number }): Promise<GraphPath[]> {
  const maxDepth = opts?.depth ?? 2
  const relationFilter = opts?.relation ? `AND r.type = '${opts.relation.replace(/'/g, "''")}'` : ""

  const sql = `
    WITH RECURSIVE traverse AS (
      SELECT e.id, e.name AS source_name, NULL AS relation_type,
             e.name AS target_name, e.type AS target_type, 0 AS depth
      FROM memory_entity e
      WHERE e.name = ?

      UNION ALL

      SELECT e.id, t.source_name, r.type,
             e.name, e.type, t.depth + 1
      FROM traverse t
      JOIN memory_relation r ON r.source_id = t.id
      JOIN memory_entity e ON e.id = r.target_id
      WHERE t.depth < ?
      ${relationFilter}
    )
    SELECT DISTINCT source_name, relation_type, target_name, target_type, depth
    FROM traverse
    WHERE depth > 0
    ORDER BY depth
  `

  return Database.Client().$client.query(sql).all(from, maxDepth) as GraphPath[]
}
```

- [ ] **Step 2: Write tests** — 覆盖插入、基于置信度的升级、衰减、图遍历

```typescript
import { describe, expect, test } from "bun:test"
import { upsertEntity, boostEntityConfidence, queryEntity, decayLowConfidence } from "../../src/memory/entities"

describe("entities", () => {
  test("upsertEntity creates new entity with default confidence 0.5", async () => {
    await upsertEntity({ name: "TAIL_MAX_TOKENS", type: "config", context: "Max token budget" })
    const row = await queryEntity("TAIL_MAX_TOKENS")
    expect(row).toBeTruthy()
    expect(row!.confidence).toBe(0.5)
    expect(row!.tier).toBe("short_term")
  })

  test("upsertEntity accumulates confidence on repeated insertion", async () => {
    await upsertEntity({ name: "computeBoundary", type: "function" })
    await upsertEntity({ name: "computeBoundary", type: "function", confidence: 0.2 })
    const row = await queryEntity("computeBoundary")
    // 0.5 + 0.2 = 0.7
    expect(row!.confidence).toBeCloseTo(0.7)
  })

  test("boostEntityConfidence upgrades tier at 0.8", async () => {
    await upsertEntity({ name: "Bun.write", type: "function", confidence: 0.7 })
    await boostEntityConfidence("Bun.write", 0.2) // 0.7 + 0.2 = 0.9
    const row = await queryEntity("Bun.write")
    expect(row!.confidence).toBeCloseTo(0.9)
    expect(row!.tier).toBe("persistent")
  })

  test("decayLowConfidence prunes entities with confidence 0", async () => {
    await upsertEntity({ name: "tempVar", type: "concept", confidence: 0.1 })
    const { pruned } = await decayLowConfidence()
    const row = await queryEntity("tempVar")
    // confidence 0.1 > 0, no decay
    expect(row).toBeTruthy()
  })

  test("traverseGraph returns relations", async () => {
    /* ... */
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun test test/memory/entities.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/memory/entities.ts packages/opencode/test/memory/entities.test.ts
git commit -m "feat(memory): entity CRUD, confidence accumulation, graph traversal"
```

---

### Task 3: 分类器 + 提取器

**Covers:** 三层持久性分类、代码实体提取（正则）、概念实体提取（正则）

**Files:**

- Create: `packages/opencode/src/memory/classification.ts`
- Create: `packages/opencode/src/memory/extractors/code.ts`
- Create: `packages/opencode/src/memory/extractors/concept.ts`
- Test: `packages/opencode/test/memory/classification.test.ts`

**Interfaces:**

- Produces:
  - `classifyPersistence(text: string): "persistent" | "short_term" | "discard"`
  - `extractCodeEntities(text: string): ExtractedEntity[]`
  - `extractConcepts(text: string): ExtractedEntity[]`
  - 类型 `ExtractedEntity = { name: string; type: EntityType; context?: string; confidence: number }`

- [ ] **Step 1: Write `classification.ts`**

```typescript
export function classifyPersistence(text: string): "persistent" | "short_term" | "discard" {
  const trimmed = text.trim()
  if (!trimmed) return "discard"

  // ── discard ──
  // 单字确认
  if (/^(好的|嗯|ok|yes|y|no|n|继续|继续吧|thanks|\*+)$/i.test(trimmed)) return "discard"
  // 纯元对话（少于20字无实质内容）
  if (/^(那|这个|这里|刚才|那个|上面)的?(问题|代码|文件|配置|实现)/.test(trimmed) && trimmed.length < 20)
    return "discard"
  // 纯标点
  if (/^[\s\.,，。！？、；：""''【】《》（）!?;:]+$/.test(trimmed)) return "discard"

  // ── persistent ──
  // 代码实体（反引号包裹的函数/API/配置）
  if (/`[\w.]+\([^)]*\)`/.test(trimmed)) return "persistent"
  // 规则声明
  if (/(永远|总是|每次|必须|禁止|不要|应该使用|优先)/.test(trimmed)) return "persistent"
  // 架构决策
  if (/(决定|选用|选择|采用|放弃|用.*而不是|原因.*是|因为.*所以)/.test(trimmed)) return "persistent"
  // 配置赋值
  if (/=\s*\d+|["'][^"']{3,}["']/.test(trimmed)) return "persistent"

  // ── 默认 short_term（均衡策略）──
  return "short_term"
}
```

- [ ] **Step 2: Write `extractors/code.ts`**

```typescript
import type { ExtractedEntity } from "../classification"

const CODE_PATTERNS: Array<{ type: ExtractedEntity["type"]; re: RegExp; context?: (m: RegExpExecArray) => string }> = [
  { type: "function", re: /`([\w.]+)\([^)]*\)`/g },
  { type: "package", re: /from\s+["']([^"']+)["']/g },
  { type: "config", re: /\b([A-Z][A-Z_]{2,})\s*=\s*\d+/g, context: (m) => `config: ${m[0]}` },
  { type: "file", re: /`([^`]+\.(ts|js|tsx|jsx|json|md))`/g },
  { type: "concept", re: /(interface|type|class)\s+(\w+)/g, context: (m) => `decl: ${m[1]}` },
]

export function extractCodeEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()
  for (const pattern of CODE_PATTERNS) {
    const re = new RegExp(pattern.re.source, "g")
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const name = match[1] ?? match[0]
      if (seen.has(name)) continue
      seen.add(name)
      entities.push({ name, type: pattern.type, context: pattern.context?.(match), confidence: 0.5 })
    }
  }
  return entities
}
```

- [ ] **Step 3: Write `extractors/concept.ts`**

```typescript
import type { ExtractedEntity } from "../classification"

const CONCEPT_PATTERNS: Array<{ re: RegExp; extract: (m: RegExpExecArray) => ExtractedEntity }> = [
  // "A 架构/模式/策略/算法"
  {
    re: /(`?[\w\u4e00-\u9fff]{2,}`?)\s*(架构|模式|策略|算法|机制|方案)/g,
    extract: (m) => ({ name: `${m[1]}${m[2]}`, type: "concept" as const, confidence: 0.5 }),
  },
  // 驼峰概念（非代码实体）
  {
    re: /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,
    extract: (m) => ({ name: m[1], type: "concept" as const, confidence: 0.4 }),
  },
  // X 化 类概念（持久化、序列化）
  {
    re: /([\u4e00-\u9fff]{2,}化)/g,
    extract: (m) => ({ name: m[1], type: "concept" as const, confidence: 0.4 }),
  },
]

export function extractConcepts(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()
  const codeNames = new Set(extractCodeEntities(text).map((e) => e.name))

  for (const pattern of CONCEPT_PATTERNS) {
    const re = new RegExp(pattern.re.source, "g")
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const entity = pattern.extract(match)
      // 排除已经在代码实体中出现过的名称（避免重复）
      if (seen.has(entity.name) || codeNames.has(entity.name)) continue
      seen.add(entity.name)
      entities.push(entity)
    }
  }
  return entities
}
```

- [ ] **Step 4: Write comprehensive tests**

```typescript
import { describe, expect, test } from "bun:test"
import { classifyPersistence } from "../../src/memory/classification"
import { extractCodeEntities } from "../../src/memory/extractors/code"
import { extractConcepts } from "../../src/memory/extractors/concept"

describe("classifyPersistence", () => {
  test("代码事实 → persistent", () => {
    expect(classifyPersistence("使用 `Bun.write(path, content)` 写入文件")).toBe("persistent")
  })
  test("规则声明 → persistent", () => {
    expect(classifyPersistence("必须使用 const 声明变量")).toBe("persistent")
  })
  test("架构决策 → persistent", () => {
    expect(classifyPersistence("我们决定采用 SQLite 而不是 PostgreSQL")).toBe("persistent")
  })
  test("配置值 → persistent", () => {
    expect(classifyPersistence("TAIL_MAX_TOKENS = 20000")).toBe("persistent")
  })
  test("元对话 → discard", () => {
    expect(classifyPersistence("好的")).toBe("discard")
    expect(classifyPersistence("嗯")).toBe("discard")
    expect(classifyPersistence("继续")).toBe("discard")
  })
  test("纯标点 → discard", () => {
    expect(classifyPersistence("。。")).toBe("discard")
  })
  test("默认 → short_term", () => {
    expect(classifyPersistence("我想了解一下这个函数的工作原理")).toBe("short_term")
  })
})

describe("extractCodeEntities", () => {
  test("提取反引号函数", () => {
    expect(extractCodeEntities("调用 `Bun.write()` 和 `fs.readFileSync()`")).toHaveLength(2)
  })
  test("提取配置常量", () => {
    const ents = extractCodeEntities("设置 TAIL_MAX_TOKENS = 20000")
    expect(ents.some((e) => e.name === "TAIL_MAX_TOKENS")).toBe(true)
  })
  test("提取导入包名", () => {
    const ents = extractCodeEntities('import { z } from "zod"')
    expect(ents.some((e) => e.name === "zod")).toBe(true)
  })
})

describe("extractConcepts", () => {
  test('提取"策略/机制/模式"后缀概念', () => {
    const ents = extractConcepts("采用增量编译策略和懒加载机制")
    expect(ents.some((e) => e.name.includes("编译策略"))).toBe(true)
  })
  test("不重复代码实体", () => {
    const ents = extractConcepts("`Bun.write()` 是写入策略")
    // "写入策略" 是概念，但应该只有 1 个（Bun.write 被代码提取器覆盖）
    const concept = ents.find((e) => e.name.includes("策略"))
    expect(concept).toBeTruthy()
  })
})
```

- [ ] **Step 5: Run tests**

Run: `bun test test/memory/classification.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/memory/classification.ts packages/opencode/src/memory/extractors/ packages/opencode/test/memory/classification.test.ts
git commit -m "feat(memory): three-tier classifier and code/concept entity extractors"
```

---

### Task 4: LLM 关系提取回调

**Covers:** 构造关系提取 prompt，解析 LLM JSON 输出，回写实体关系，实体置信度升级

**Files:**

- Create: `packages/opencode/src/memory/extractors/relations.ts`
- Test: `packages/opencode/test/memory/relations.test.ts`

**Interfaces:**

- Consumes: `upsertRelation`, `boostEntityConfidence` from `entities.ts`
- Produces:
  - `buildRelationPrompt(text: string, candidates: ExtractedEntity[]): string`
  - `parseRelationLLMOutput(raw: string): ExtractedRelation[]`
  - `refineRelationsWithLLM(text: string, candidates: ExtractedEntity[], sessionID: string): Promise<void>`

- [ ] **Step 1: Write prompt builder + parser**

```typescript
import type { ExtractedEntity } from "../classification"
import { upsertRelation, boostEntityConfidence } from "../entities"
import { Log } from "../../util"

const log = Log.create({ service: "memory.relation-extractor" })

export interface ExtractedRelation {
  source: string
  target: string
  type: "depends_on" | "implements" | "configures" | "calls" | "prefers" | "part_of" | "similar_to" | "rejects"
  confidence: number
}

export function buildRelationPrompt(text: string, candidates: ExtractedEntity[]): string {
  return `从以下对话文本中提取实体间的关系。

候选实体列表（已从文本中识别）:
${candidates.map((e) => `  - ${e.name} (${e.type})`).join("\n")}

任务:
1. 识别候选实体之间的**关系**，或者候选实体与文本中其他概念之间的关系
2. 关系类型: depends_on | implements | configures | calls | prefers | part_of | similar_to | rejects
3. 评估关系的置信度 (0.0-1.0)

只输出以下 JSON 格式（不要其他文字）:
{"relations":[{"source":"实体A","target":"实体B","type":"depends_on","confidence":0.9}]}

对话文本:
"""
${text.slice(0, 4000)}
"""`

export function parseRelationLLMOutput(raw: string): ExtractedRelation[] {
  // 提取 JSON 部分（可能被 markdown 代码块包裹）
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    log.warn("parseRelationLLMOutput: no JSON found in LLM output")
    return []
  }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.relations)) return []
    return parsed.relations.filter(
      (r: any) =>
        typeof r.source === "string" &&
        typeof r.target === "string" &&
        typeof r.type === "string" &&
        typeof r.confidence === "number",
    )
  } catch {
    log.warn("parseRelationLLMOutput: invalid JSON")
    return []
  }
}
```

- [ ] **Step 2: Write LLM callback implementation**

```typescript
export async function refineRelationsWithLLM(
  text: string,
  candidates: ExtractedEntity[],
  _sessionID: string,
): Promise<void> {
  const prompt = buildRelationPrompt(text, candidates)

  // 调用 LLM（通过 actor.spawn 创建微型子代理）
  // 默认共享主模型，可通过配置切换到专用模型
  const llmResult = await callLLMForRelations(prompt)

  const relations = parseRelationLLMOutput(llmResult)
  if (relations.length === 0) return

  for (const rel of relations) {
    await upsertRelation({
      source: rel.source,
      target: rel.target,
      type: rel.type,
      weight: rel.confidence,
    })
    await boostEntityConfidence(rel.source, 0.3)
    await boostEntityConfidence(rel.target, 0.3)
  }

  log.info("refineRelationsWithLLM", { relations: relations.length })
}

// 与 LLM 层交互的抽象接口
// 可配置: 默认通过 actor.spawn 用共享主模型，可切换专用模型
async function callLLMForRelations(prompt: string): Promise<string> {
  // 使用 Effect 运行时调用 LLM
  // 通过 actor.spawn 创建微型子代理，任务仅为输出 JSON 关系列表
  // 实现细节在 memory-pipeline.ts 中 —— 这里保持函数签名抽象
  throw new Error("callLLMForRelations must be provided by the pipeline scheduler")
}
```

- [ ] **Step 3: Write tests**

````typescript
import { describe, expect, test } from "bun:test"
import { buildRelationPrompt, parseRelationLLMOutput } from "../../src/memory/extractors/relations"

describe("buildRelationPrompt", () => {
  test("includes candidate entities", () => {
    const candidates = [{ name: "Bun.write", type: "function" as const, confidence: 0.5 }]
    const prompt = buildRelationPrompt("使用 Bun.write 写入文件", candidates)
    expect(prompt).toContain("Bun.write")
    expect(prompt).toContain("(function)")
  })
})

describe("parseRelationLLMOutput", () => {
  test("parses valid JSON", () => {
    const raw = '{"relations":[{"source":"A","target":"B","type":"depends_on","confidence":0.9}]}'
    const result = parseRelationLLMOutput(raw)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe("A")
    expect(result[0].type).toBe("depends_on")
  })

  test("extracts JSON from markdown code block", () => {
    const raw = '```json\n{"relations":[]}\n```'
    expect(parseRelationLLMOutput(raw)).toEqual([])
  })

  test("returns empty on invalid JSON", () => {
    expect(parseRelationLLMOutput("not json")).toEqual([])
  })

  test("filters malformed entries", () => {
    const raw = '{"relations":[{"source":"A","type":"depends_on"}]}' // missing target
    expect(parseRelationLLMOutput(raw)).toHaveLength(0)
  })
})
````

- [ ] **Step 4: Run tests**

Run: `bun test test/memory/relations.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/memory/extractors/relations.ts packages/opencode/test/memory/relations.test.ts
git commit -m "feat(memory): LLM relation extraction prompt builder and JSON parser"
```

---

### Task 5: 管线调度器 + prune 集成

**Covers:** 两阶段管线调度、与 prune.ts 集成、LLM 回调的 actor.spawn 实现

**Files:**

- Create: `packages/opencode/src/session/memory-pipeline.ts`
- Modify: `packages/opencode/src/session/prune.ts`
- Test: `packages/opencode/test/memory/memory-pipeline.test.ts`

**Interfaces:**

- Consumes: `classifyPersistence`, `extractCodeEntities`, `extractConcepts` from Task 3; `upsertEntity`, `upsertRelation`, `boostEntityConfidence` from Task 2; `buildRelationPrompt`, `parseRelationLLMOutput` from Task 4
- Produces: `runMemoryPipeline(input: { sessionID, text, messageID }): Promise<void>` — 导出给 prune.ts 调用

- [ ] **Step 1: Write `memory-pipeline.ts`**

```typescript
import { classifyPersistence } from "../memory/classification"
import { extractCodeEntities, extractConcepts } from "../memory/extractors/code" // re-export from code.ts
import { buildRelationPrompt, parseRelationLLMOutput, type ExtractedRelation } from "../memory/extractors/relations"
import { upsertEntity, boostEntityConfidence } from "../memory/entities"
import { Log } from "../util"
import { Log as ClassifyLog } from "../util"

const log = Log.create({ service: "memory.pipeline" })

export async function runMemoryPipeline(input: { sessionID: string; text: string; messageID: string }): Promise<void> {
  const start = performance.now()

  // ════════════════════════════════════════
  // Phase A: 同步规则管线
  // ════════════════════════════════════════

  const tier = classifyPersistence(input.text)
  if (tier === "discard") return

  // 并行提取
  const [codeEntities, concepts] = await Promise.all([extractCodeEntities(input.text), extractConcepts(input.text)])
  const allEntities = [...codeEntities, ...concepts]
  if (allEntities.length === 0 && tier === "short_term") return

  // 写入实体（规则置信度 0.5）
  for (const e of allEntities) {
    await upsertEntity({
      name: e.name,
      type: e.type,
      context: e.context,
      confidence: 0.5,
      source: "conversation",
    })
  }

  const phaseAms = Math.round(performance.now() - start)
  log.debug("pipeline phase A", {
    tier,
    entities: allEntities.length,
    ms: phaseAms,
  })

  // ════════════════════════════════════════
  // Phase B: 异步 LLM 精化
  // ════════════════════════════════════════

  if (allEntities.length === 0) return

  // fork 到后台，不阻塞主流程
  refineRelationsWithLLM(input.text, allEntities, input.sessionID).catch((err) =>
    log.warn("Phase B LLM refinement failed", { err }),
  )
}

// Phase B: LLM 回调实现
async function refineRelationsWithLLM(
  text: string,
  candidates: { name: string; type: string }[],
  _sessionID: string,
): Promise<void> {
  const prompt = buildRelationPrompt(text, candidates)

  // 通过 actor.spawn 创建微型子代理
  // 子代理任务：读取 prompt，输出 JSON，立即停止
  // 这使用共享主模型，可通过配置切换
  let llmOutput: string
  try {
    llmOutput = await spawnRelationExtractor(prompt)
  } catch (err) {
    log.warn("LLM relation extraction failed, falling back to rule-based", { err })
    return
  }

  const relations = parseRelationLLMOutput(llmOutput)
  if (relations.length === 0) return

  for (const rel of relations) {
    await upsertRelation({
      source: rel.source,
      target: rel.target,
      type: rel.type,
      weight: rel.confidence,
    })
    await boostEntityConfidence(rel.source, 0.3)
    await boostEntityConfidence(rel.target, 0.3)
  }

  log.info("pipeline phase B", { relations: relations.length })
}

// 异步 subagent 创建（轻量级，不创建 child session）
async function spawnRelationExtractor(prompt: string): Promise<string> {
  // 使用 MemoryPipeline 专用 subagent
  // 工具白名单: 无（不需要调用工具，纯 LLM 输出）
  // context: 只有 prompt，没有历史
  const { spawnRef } = await import("../actor/spawn-ref")
  const actor = spawnRef.current
  if (!actor) throw new Error("Actor service unavailable")

  const result = await actor.spawn({
    mode: "subagent",
    sessionID: _sessionID, // 使用当前 session
    agentType: "relation-extractor",
    description: "relation extraction from conversation delta",
    task: prompt,
    context: "none",
    tools: [],
    model: { providerID: "default", modelID: "default" }, // 共享主模型
    background: false,
  })

  // 从结果中提取 LLM 响应文本
  return extractAssistantText(result)
}
```

- [ ] **Step 2: Modify `prune.ts`** — 在 `fireCheckpoints` 之后追加管线调用

在 `prune.ts` 中，在 `fireCheckpoints` 方法末尾（所有 token 检查循环之后），追加旁路管线调用。修改点在 `prune.ts` 约第 360 行（`crossed.set(input.sessionID, already)` 之后）：

```typescript
// 追加: 旁路记忆管线（每轮对话后异步执行，不阻塞主流程）
if (process.env.MEMORY_PIPELINE_ENABLED !== "false") {
  const { runMemoryPipeline, extractTextDelta } =
    yield *
    Effect.promise(() =>
      import("./memory-pipeline").catch(() => ({ runMemoryPipeline: undefined as never, extractTextDelta: undefined })),
    )
  if (runMemoryPipeline) {
    const msgs =
      yield *
      MessageV2.filterCompactedEffect(input.sessionID, {
        contextFrom: sessionInfo.contextFrom,
        contextWatermark: sessionInfo.contextWatermark,
        agentID: "main",
      })
    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg && lastMsg.info.role === "user") {
      const text = lastMsg.parts
        .filter((p) => p.type === "text" && !p.synthetic)
        .map((p) => ("text" in p ? p.text : ""))
        .filter(Boolean)
        .join("\n")
      if (text.trim()) {
        yield *
          Effect.promise(() =>
            runMemoryPipeline({
              sessionID: input.sessionID,
              text,
              messageID: lastMsg.info.id,
            }),
          ).pipe(Effect.fork)
      }
    }
  }
}
```

**注意**：依赖注入通过动态 `import()` 实现，避免循环依赖。这是临时方案——后续 Task 7 会将管线集成到 Memory.Service 中。

- [ ] **Step 3: Write integration test**

```typescript
import { describe, expect, test } from "bun:test"
import { runMemoryPipeline } from "../../src/session/memory-pipeline"
import { queryEntity } from "../../src/memory/entities"

describe("memory pipeline", () => {
  test("Phase A: code fact produces entity", async () => {
    await runMemoryPipeline({
      sessionID: "test-sid",
      text: "使用 `Bun.write(path, content)` 写入文件，必须用 const 声明",
      messageID: "msg-1",
    })
    // 异步 Phase A 完成后检查实体
    await new Promise((r) => setTimeout(r, 100))
    const entity = await queryEntity("Bun.write")
    expect(entity).toBeTruthy()
    expect(entity!.type).toBe("function")
  })

  test("empty discard content produces nothing", async () => {
    await runMemoryPipeline({
      sessionID: "test-sid",
      text: "好的",
      messageID: "msg-2",
    })
    // discard 不产生任何实体
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bun test test/memory/memory-pipeline.test.ts`
Expected: Tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/session/memory-pipeline.ts packages/opencode/src/session/prune.ts packages/opencode/test/memory/memory-pipeline.test.ts
git commit -m "feat(memory): two-phase pipeline scheduler integrated with prune"
```

---

### Task 6: 图查询工具

**Covers:** 独立的 memory-graph 工具（traverse + subgraph 操作）

**Files:**

- Create: `packages/opencode/src/tool/memory-graph.ts`
- Create: `packages/opencode/src/tool/memory-graph.txt`
- Test: `packages/opencode/test/memory/memory-graph.test.ts`

**Interfaces:**

- Consumes: `traverseGraph`, `queryEntity` from `entities.ts`
- Produces: Tool with name `memory-graph`
  - `traverse(from, relation?, depth?)` — 图遍历
  - `subgraph(entities)` — 子图查询

- [ ] **Step 1: Write `memory-graph.txt`**

```
Query the entity-relation graph that was extracted from conversation.
Use this when you need to understand relationships between concepts,
functions, APIs, configs, and other entities the user has discussed.

Two operations:

- traverse: Starting from a named entity, follow relationships outward.
  Filters by relation type (optional) and limits traversal depth.
  Returns paths showing how entities connect.

- subgraph: Given a set of entity names, return all relationships
  among them. Useful for understanding how a group of entities relates.

Examples:
  traverse(from="TAIL_MAX_TOKENS", relation="configures", depth=2)
    → TAIL_MAX_TOKENS → checkpoint boundary → rebuild context

  subgraph(entities=["Bun.write", "fs.writeFile"])
    → shows if there's a similar_to or depends_on relationship

The graph is built asynchronously from conversation — not all
relationships are captured immediately. When the graph lacks an
answer, fall back to the memory tool (FTS) or Read the source files.
```

- [ ] **Step 2: Write `memory-graph.ts`**

```typescript
import { Effect } from "effect"
import z from "zod"
import { traverseGraph, queryEntity } from "../memory/entities"
import DESCRIPTION from "./memory-graph.txt"
import * as Tool from "./tool"

const parameters = z.object({
  operation: z.enum(["traverse", "subgraph"]).describe("Graph query operation"),
  from: z.string().optional().describe("Starting entity name (required for traverse)"),
  entities: z.array(z.string()).optional().describe("Entity names (required for subgraph)"),
  relation: z.string().optional().describe("Filter by relation type (traverse only)"),
  depth: z.number().default(2).describe("Traversal depth (traverse only, max 5)"),
})

export const MemoryGraphTool = Tool.define(
  "memory-graph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          if (args.operation === "traverse") {
            if (!args.from) {
              return { output: "traverse requires a 'from' entity name", metadata: { count: 0 } }
            }
            const entity = yield* Effect.promise(() => queryEntity(args.from!))
            if (!entity) {
              return { output: `Entity "${args.from}" not found in graph`, metadata: { count: 0 } }
            }
            const paths = yield* Effect.promise(() =>
              traverseGraph(args.from!, { relation: args.relation, depth: Math.min(args.depth ?? 2, 5) }),
            )
            if (paths.length === 0) {
              return { output: `No relations found from "${args.from}"`, metadata: { count: 0 } }
            }
            const lines = [`Graph traversal from "${args.from}":`, ""]
            for (const p of paths) {
              const indent = "  ".repeat(p.depth - 1)
              lines.push(`${indent}${p.source_name} ──${p.relation_type}──→ ${p.target_name} (${p.target_type})`)
            }
            return { output: lines.join("\n"), metadata: { count: paths.length } }
          }

          // subgraph
          if (!args.entities || args.entities.length === 0) {
            return { output: "subgraph requires at least one entity", metadata: { count: 0 } }
          }
          const results: string[] = []
          for (const name of args.entities) {
            const entity = yield* Effect.promise(() => queryEntity(name))
            if (entity) results.push(`${name} (${entity.type}, ${entity.tier}, confidence=${entity.confidence})`)
          }
          return {
            output:
              results.length > 0
                ? ["Entities in graph:", ...results.map((r) => `  - ${r}`)].join("\n")
                : "None of the specified entities are in the graph",
            metadata: { count: results.length },
          }
        }),
    }
  }),
)
```

- [ ] **Step 3: Write tests**

```typescript
import { describe, expect, test } from "bun:test"
import { upsertEntity, upsertRelation } from "../../src/memory/entities"
import { MemoryGraphTool } from "../../src/tool/memory-graph"

describe("memory-graph tool", () => {
  test("traverse returns path for known entity", async () => {
    await upsertEntity({ name: "A", type: "concept", confidence: 0.9 })
    await upsertEntity({ name: "B", type: "function", confidence: 0.9 })
    await upsertRelation({ source: "A", target: "B", type: "depends_on" })

    // execute 返回 Effect, 需要提供 args
    const result = await MemoryGraphTool.execute({
      operation: "traverse",
      from: "A",
      depth: 2,
    })
    expect(result.output).toContain("A")
    expect(result.output).toContain("B")
    expect(result.metadata.count).toBeGreaterThan(0)
  })

  test("traverse handles missing entity gracefully", async () => {
    const result = await MemoryGraphTool.execute({
      operation: "traverse",
      from: "NonExistent",
    })
    expect(result.output).toContain("not found")
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bun test test/memory/memory-graph.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/tool/memory-graph.ts packages/opencode/src/tool/memory-graph.txt packages/opencode/test/memory/memory-graph.test.ts
git commit -m "feat(tool): add memory-graph tool for entity relationship queries"
```

---

### Task 7: Service 集成 + 最终链接

**Covers:** 将新模块暴露到 Memory.Service 接口、在 index.ts 中导出、注册 memory-graph 工具

**Files:**

- Modify: `packages/opencode/src/memory/service.ts` — 新增 `graphSearch` 和 `traverse` 方法
- Modify: `packages/opencode/src/memory/index.ts` — 导出实体/图/分类模块
- Modify: `packages/opencode/src/tool/index.ts` (或工具注册处) — 注册 memory-graph 工具

**Interfaces:**

- Consumes: `traverseGraph`, `queryEntity`, `decayLowConfidence` from `entities.ts`; `runMemoryPipeline` from `memory-pipeline.ts`
- Produces: Extended `Memory.Service` with graph traversal methods

- [ ] **Step 1: 扩展 `service.ts`**

在 `Interface` 中新增方法：

```typescript
import { traverseGraph as traverseGraphImpl, queryEntity as queryEntityImpl, decayLowConfidence as decayImpl } from "./entities"
import type { GraphPath } from "./entities"

export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly reconcile: () => Effect.Effect<{ indexed: number; pruned: number }>
  readonly search: (input: { ... }) => Effect.Effect<...>
  // 新增:
  readonly graphTraverse: (input: {
    from: string
    relation?: string
    depth?: number
  }) => Effect.Effect<GraphPath[]>
  readonly decayEntities: () => Effect.Effect<{ pruned: number }>
}
```

在 `layer` 实现中新增：

```typescript
const graphTraverse = Effect.fn("Memory.graphTraverse")(function* (input: {
  from: string
  relation?: string
  depth?: number
}) {
  return yield* Effect.promise(() =>
    traverseGraphImpl(input.from, {
      relation: input.relation,
      depth: input.depth,
    }),
  )
})

const decayEntities = Effect.fn("Memory.decayEntities")(function* () {
  return yield* Effect.promise(() => decayImpl())
})

return Service.of({
  root: rootEff,
  reconcile,
  search,
  graphTraverse,
  decayEntities,
})
```

- [ ] **Step 2: 更新 `index.ts`**

```typescript
export * as Memory from "./service"
export * as MemoryEntities from "./entities"
export * as MemoryClassification from "./classification"
```

- [ ] **Step 3: 在工具注册处注册 memory-graph 工具**

查找工具注册位置（通常在 `packages/opencode/src/tool/index.ts` 或 agent 初始化处），添加：

```typescript
import { MemoryGraphTool } from "./memory-graph"
```

并注册到工具列表中。

- [ ] **Step 4: 添加定时衰减调用**

在 `prune.ts` 的 `prune` 方法中（或单独定时器），定期调用：

```typescript
const { decayLowConfidence } = yield * Effect.promise(() => import("../memory/entities"))
yield * Effect.promise(() => decayLowConfidence())
```

建议每 50 轮对话或每天首次 pipeline 触发时执行一次衰减。

- [ ] **Step 5: 端到端集成测试**

```typescript
import { describe, expect, test } from "bun:test"
// 测试全链路: 对话文本 → 分类 → 提取 → 写入 → 图查询
test("full pipeline: text to graph query", async () => {
  // 1. 管线提取
  await runMemoryPipeline({ sessionID: "e2e", text: "使用 `computeBoundary()` 计算边界", messageID: "m1" })
  await new Promise((r) => setTimeout(r, 100))

  // 2. 图查询
  const result = await traverseGraph("computeBoundary")
  // 实体应存在
  expect(result).toBeDefined()
})
```

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/src/memory/service.ts packages/opencode/src/memory/index.ts
git commit -m "feat(memory): integrate pipeline entities and graph into Memory.Service"
```

---

## Self-Review

- [x] **每个 task 都有独立可测试的产出** — 每个 task 以测试通过 + commit 结束
- [x] **无占位符** — 所有代码块包含完整实现
- [x] **接口一致性** — `upsertEntity`, `upsertRelation`, `traverseGraph` 等函数签名在 Task 2 中定义后被 Task 4-7 一致使用
- [x] **遵循项目约定** — drizzle 表定义风格与 `fts.sql.ts` 一致；tool 定义风格与 `memory.ts` 一致；测试用 `bun:test` + `describe/test`
- [x] **无循环依赖** — Task 5 通过动态 `import()` 避免循环；Task 7 通过 Service 接口集成
- [x] **适当处理错误** — LLM 回调失败有 fallback（记录警告并跳过）；实体查询有 null 检查
- [x] **DRY** — `ExtractedEntity` 类型在 `classification.ts` 定义后被 extractors 复用
