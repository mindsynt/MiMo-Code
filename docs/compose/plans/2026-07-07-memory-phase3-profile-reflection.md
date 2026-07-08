# Phase 3: 用户画像 + 反思 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user profiling (explicit/implicit preference extraction) and a periodic reflection subagent that infers patterns, updates MEMORY.md, and manages auto-forgetting of stale data.

**Architecture:** Profile table in bun:sqlite stores user preferences with confidence-based lifecycle. Classification pipeline extracts explicit preferences from conversation. A reflection subagent runs periodically (every N checkpoints) to scan accumulated data, infer patterns, promote persistent knowledge, and clean expired entries.

**Tech Stack:** TypeScript, Bun, drizzle-orm/sqlite-core, Effect

**Prerequisites:** Phase 1 + Phase 2 on branch feat/memory-optimization.

---

## File Structure

```
packages/opencode/src/memory/
├── profile.sql.ts           (NEW)  — memory_user_profile schema
├── profile.ts               (NEW)  — profile CRUD + preference extraction
├── reflection-writer.txt    (NEW)  — reflection subagent prompt template
├── reflection.ts            (NEW)  — reflection subagent scheduler
├── cleanup.ts               (NEW)  — auto-forgetting: TTL cleanup
├── pipeline.sql.ts          (MOD)  — no change
├── service.ts               (MOD)  — add profile CRUD + reflection trigger
├── index.ts                 (MOD)  — export new modules
├── classification.ts        (MOD)  — add classifyPersonal() for preferences

packages/opencode/src/session/
├── memory-pipeline.ts       (MOD)  — Phase A: extract preferences
├── prune.ts                 (MOD)  — trigger reflection periodically

packages/opencode/migration/
├── 20260707000002_memory_profile/  (NEW)

packages/opencode/test/memory/
├── profile.test.ts          (NEW)
├── reflection.test.ts       (NEW)
├── cleanup.test.ts          (NEW)
├── memory-pipeline.test.ts  (MOD)
```

---

### Task 1: Profile Schema

**Files:**

- Create: `packages/opencode/src/memory/profile.sql.ts`
- Create: `packages/opencode/migration/20260707000002_memory_profile/migration.sql`
- Test: test schema creation

**Step 1: Write `profile.sql.ts`**

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const ProfileTable = sqliteTable("memory_user_profile", {
  id: integer().primaryKey({ autoIncrement: true }),
  key: text().notNull().unique(), // e.g. "preferred_runtime", "disliked_orm"
  value: text().notNull(), // JSON: { value: "...", confidence: 0.8, source: "..." }
  category: text().notNull(), // explicit_preference | inferred_pattern | hidden_intent
  confidence: real().notNull().default(0.5),
  source: text().notNull().default("conversation"),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})
```

**Step 2: Migration SQL**

```sql
CREATE TABLE `memory_user_profile` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL UNIQUE,
  `value` text NOT NULL,
  `category` text NOT NULL,
  `confidence` real DEFAULT 0.5 NOT NULL,
  `source` text DEFAULT 'conversation' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
```

**Step 3: Commit**

```bash
git add packages/opencode/src/memory/profile.sql.ts packages/opencode/migration/20260707000002_memory_profile/
git commit -m "feat(memory): user profile schema"
```

---

### Task 2: Profile CRUD + Preference Extraction

**Files:**

- Create: `packages/opencode/src/memory/profile.ts`
- Modify: `packages/opencode/src/memory/classification.ts` — add classifyPersonal()
- Test: `packages/opencode/test/memory/profile.test.ts`

**Interfaces:**

- `upsertPreference(key, value, category, source, confidence)`
- `getPreference(key)`
- `listPreferences(category?)`
- `decayLowConfidencePreferences()` — reduce confidence for old inferred patterns
- `classifyPersonal(text)` — extract explicit preferences from text

**Step 1: Write `profile.ts`**

```typescript
import { Database, eq, and, lt, sql } from "@/storage"
import { ProfileTable } from "./profile.sql"

export interface ProfileEntry {
  key: string
  value: string
  category: "explicit_preference" | "inferred_pattern" | "hidden_intent"
  confidence: number
  source: string
}

export function upsertPreference(entry: ProfileEntry): void {
  const existing = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, entry.key)).get())
  const now = Date.now()

  if (existing) {
    const mergedConfidence = Math.min(1.0, existing.confidence + entry.confidence * 0.5)
    Database.use((db) =>
      db
        .update(ProfileTable)
        .set({
          value: entry.value,
          confidence: mergedConfidence,
          category: entry.category,
          updated_at: now,
        })
        .where(eq(ProfileTable.id, existing.id))
        .run(),
    )
  } else {
    Database.use((db) =>
      db
        .insert(ProfileTable)
        .values({
          key: entry.key,
          value: entry.value,
          category: entry.category,
          confidence: entry.confidence,
          source: entry.source,
          created_at: now,
          updated_at: now,
        })
        .run(),
    )
  }
}

export function getPreference(key: string): ProfileEntry | undefined {
  const row = Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.key, key)).get())
  if (!row) return undefined
  return {
    key: row.key,
    value: row.value,
    category: row.category as any,
    confidence: row.confidence,
    source: row.source,
  }
}

export function listPreferences(category?: string): ProfileEntry[] {
  const rows = category
    ? Database.use((db) => db.select().from(ProfileTable).where(eq(ProfileTable.category, category)).all())
    : Database.use((db) => db.select().from(ProfileTable).all())
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    category: r.category as any,
    confidence: r.confidence,
    source: r.source,
  }))
}

export function decayLowConfidencePreferences(): number {
  const now = Date.now()
  const threshold = now - 30 * 86400_000 // 30 days

  Database.use((db) =>
    db
      .update(ProfileTable)
      .set({
        confidence: sql`MAX(0.0, confidence - 0.1)`,
      })
      .where(
        and(
          eq(ProfileTable.category, "inferred_pattern"),
          lt(ProfileTable.confidence, 0.6),
          lt(ProfileTable.updated_at, threshold),
        ),
      )
      .run(),
  )

  const pruned = Database.use((db) =>
    db
      .delete(ProfileTable)
      .where(and(lt(ProfileTable.confidence, 0.01), eq(ProfileTable.category, "inferred_pattern")))
      .run(),
  )
  return pruned.changes
}
```

**Step 2: Add `classifyPersonal()` to `classification.ts`**

The idea is to detect user statements that express preferences:

```typescript
export function classifyPersonal(text: string): Array<{ key: string; value: string; confidence: number }> {
  const results: Array<{ key: string; value: string; confidence: number }> = []

  // 显式偏好: "我喜欢用X" / "我习惯X" / "我更倾向于X"
  const explicitPref = /(?:我喜欢用|我习惯用|我更倾向|优先使用|最好用|推荐使用)\s*[`]?([\w.\-/]+)[`]?/
  const m1 = text.match(explicitPref)
  if (m1) results.push({ key: "preferred_tool", value: m1[1], confidence: 0.9 })

  // 否定偏好: "不要用X" / "别用X" / "不用X"
  const negativePref = /(?:不要用|别用|不用|避免使用|少用)\s*[`]?([\w.\-/]+)[`]?/
  const m2 = text.match(negativePref)
  if (m2) results.push({ key: "disliked_tool", value: m2[1], confidence: 0.8 })

  // 规则声明: "必须/应该/要使用X"
  const rulePref = /(?:必须|应该|要)\s*(?:使用|用)\s*[`]?([\w.\-/]+)[`]?/
  const m3 = text.match(rulePref)
  if (m3) results.push({ key: "required_tool", value: m3[1], confidence: 0.7 })

  return results
}
```

**Step 3: Tests**

```typescript
describe("profile", () => {
  test("upsertPreference creates and accumulates", () => {
    upsertPreference({
      key: "preferred_runtime",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.7,
      source: "user_said",
    })
    expect(getPreference("preferred_runtime")!.confidence).toBe(0.7)
    upsertPreference({
      key: "preferred_runtime",
      value: "bun",
      category: "explicit_preference",
      confidence: 0.7,
      source: "user_said",
    })
    expect(getPreference("preferred_runtime")!.confidence).toBeCloseTo(1.0) // 0.7 + 0.7*0.5 = 1.0
  })

  test("listPreferences filters by category", () => {
    const inferred = listPreferences("inferred_pattern")
    expect(Array.isArray(inferred)).toBe(true)
  })
})

describe("classifyPersonal", () => {
  test("extracts explicit preference", () => {
    const r = classifyPersonal("我喜欢用 Bun")
    expect(r.some((x) => x.key === "preferred_tool" && x.value === "Bun")).toBe(true)
  })
})
```

**Step 4: Commit**

```bash
git add packages/opencode/src/memory/profile.ts packages/opencode/src/memory/classification.ts packages/opencode/test/memory/profile.test.ts
git commit -m "feat(memory): profile CRUD and explicit preference extraction"
```

---

### Task 3: Pipeline + Auto-Forgetting

**Files:**

- Create: `packages/opencode/src/memory/cleanup.ts`
- Modify: `packages/opencode/src/session/memory-pipeline.ts`
- Test: `packages/opencode/test/memory/cleanup.test.ts`

**Step 1: Write `cleanup.ts`**

```typescript
import { Database, lt, eq, and, sql } from "@/storage"
import { ChunkTable } from "./vectors.sql"
import { VectorTable } from "./vectors.sql"

export function cleanupExpired(): { expiredChunks: number; expiredVectors: number } {
  const now = Date.now()

  // Delete chunks past TTL
  const expiredChunks = Database.use((db) =>
    db
      .delete(ChunkTable)
      .where(and(lt(ChunkTable.ttl, now), eq(ChunkTable.tier, "short_term")))
      .run(),
  )

  // Vectors cascade-deleted via FK, but clean orphans just in case
  const expiredVectors = Database.use((db) =>
    db
      .delete(VectorTable)
      .where(sql`chunk_id NOT IN (SELECT id FROM memory_chunk)`)
      .run(),
  )

  return {
    expiredChunks: expiredChunks.changes,
    expiredVectors: expiredVectors.changes,
  }
}
```

**Step 2: Integrate into pipeline**

In `memory-pipeline.ts`, add cleanup call at the end of Phase A (runs ~every 50 calls):

```typescript
// Periodic cleanup (every ~50 pipeline runs)
const CLEANUP_INTERVAL = 50
let pipelineRunCount = 0
// In runMemoryPipeline, after Phase A:
pipelineRunCount++
if (pipelineRunCount % CLEANUP_INTERVAL === 0) {
  const { cleanupExpired } = await import("../memory/cleanup")
  const result = cleanupExpired()
  if (result.expiredChunks > 0 || result.expiredVectors > 0) {
    log.info("cleanup", result)
  }
}
```

**Step 3: Tests**

```typescript
test("cleanupExpired removes expired chunks", () => {
  Database.use((db) =>
    db
      .insert(ChunkTable)
      .values({
        chunk_text: "old data",
        tier: "short_term",
        ttl: Date.now() - 1000, // expired
        created_at: Date.now() - 86400_000,
      })
      .run(),
  )
  const result = cleanupExpired()
  expect(result.expiredChunks).toBeGreaterThan(0)
})
```

**Step 4: Commit**

```bash
git add packages/opencode/src/memory/cleanup.ts packages/opencode/src/session/memory-pipeline.ts packages/opencode/test/memory/cleanup.test.ts
git commit -m "feat(memory): auto-forgetting with TTL cleanup"
```

---

### Task 4: Reflection Subagent

**Files:**

- Create: `packages/opencode/src/memory/reflection-writer.txt`
- Create: `packages/opencode/src/memory/reflection.ts`
- Modify: `packages/opencode/src/session/prune.ts` — trigger reflection every N checkpoints
- Test: `packages/opencode/test/memory/reflection.test.ts`

**Step 1: Write reflection-writer.txt**

```
You are a reflection subagent. Your job is to analyze accumulated memory data and infer patterns about the user's preferences, coding style, and needs.

Read the following sources:
1. memory_user_profile table — existing preferences (both explicit and inferred)
2. memory_entity table — frequently mentioned concepts/APIs/tools
3. MEMORY.md — existing project rules and decisions

Your task:
1. Identify patterns in the user_profile data:
   - Are there multiple related preferences that suggest a higher-level preference?
   - Are there high-confidence entities that should be promoted to preferences?
   - Are there any contradictions between explicit preferences and actual usage patterns?

2. For each inferred pattern:
   - If confidence > 0.6: promote to explicit_preference
   - If confidence > 0.3 but < 0.6: record as inferred_pattern
   - If confidence < 0.3: leave as hidden_intent

3. Update MEMORY.md if new rules or architecture decisions emerge:
   - New rules → ## Rules section
   - New architecture decisions → ## Architecture decisions section

Output JSON only:
{
  "promotions": [
    { "key": "...", "value": "...", "category": "explicit_preference", "confidence": 0.8, "evidence": "user chose X 5 times" }
  ],
  "newPreferences": [
    { "key": "...", "value": "...", "category": "inferred_pattern", "confidence": 0.5 }
  ],
  "memoryUpdates": [
    { "section": "Rules", "content": "Always use bun for scripts" }
  ]
}
```

**Step 2: Write `reflection.ts`**

```typescript
import { listPreferences, upsertPreference, type ProfileEntry } from "./profile"
import { spawnRef } from "../actor/spawn-ref"
import { Log } from "../util"
import PROMPT_REFLECTION from "./reflection-writer.txt"

const log = Log.create({ service: "memory.reflection" })

export async function runReflection(): Promise<void> {
  const actor = spawnRef.current
  if (!actor) {
    log.warn("reflection skipped: actor unavailable")
    return
  }

  // Gather context for the reflection agent
  const preferences = listPreferences()
  const preferenceSummary = preferences
    .map((p) => `  - ${p.key} = ${p.value} (${p.category}, conf=${p.confidence.toFixed(2)})`)
    .join("\n")

  const prompt = [PROMPT_REFLECTION, "", "## Current preferences", preferenceSummary || "  (none)"].join("\n")

  try {
    const result = await actor.spawn({
      mode: "subagent",
      agentType: "reflection",
      description: "memory reflection",
      task: prompt,
      context: "none",
      tools: ["read", "write", "edit"],
      model: { providerID: "default", modelID: "default" },
      background: false,
    })
    log.info("reflection completed", { actorID: result.actorID })
  } catch (err) {
    log.warn("reflection failed", { err })
  }
}
```

**Step 3: Trigger in prune.ts**

In `prune.ts`, add a reflection trigger every N successful checkpoints:

```typescript
let reflectionCounter = 0
// In fireCheckpoints or prune, after a successful checkpoint:
reflectionCounter++
const REFLECTION_INTERVAL = 5 // reflect every 5 checkpoints
if (reflectionCounter % REFLECTION_INTERVAL === 0) {
  const { runReflection } =
    yield * Effect.promise(() => import("../memory/reflection").catch(() => ({ runReflection: undefined })))
  if (runReflection) {
    yield * Effect.promise(() => runReflection()).pipe(Effect.fork)
  }
}
```

**Step 4: Tests**

```typescript
test("runReflection is callable", async () => {
  // Basic test that reflection can be invoked
  // (real test requires actor service, this validates the import works)
  const { runReflection } = await import("../../src/memory/reflection")
  expect(typeof runReflection).toBe("function")
})
```

**Step 5: Commit**

```bash
git add packages/opencode/src/memory/reflection.ts packages/opencode/src/memory/reflection-writer.txt packages/opencode/src/session/prune.ts packages/opencode/test/memory/reflection.test.ts
git commit -m "feat(memory): reflection subagent for pattern inference"
```

---

### Task 5: Service Integration + Final Wiring

**Files:**

- Modify: `packages/opencode/src/memory/service.ts` — add profile methods
- Modify: `packages/opencode/src/memory/index.ts` — export new modules

**Step 1: Extend service.ts**

Add to Interface:

```typescript
readonly getPreference: (key: string) => Effect.Effect<ProfileEntry | undefined>
readonly listPreferences: (category?: string) => Effect.Effect<ProfileEntry[]>
readonly cleanupExpired: () => Effect.Effect<{ expiredChunks: number; expiredVectors: number }>
readonly runReflection: () => Effect.Effect<void>
```

Add implementations:

```typescript
const getPreferenceEff = Effect.fn("Memory.getPreference")(function* (key: string) {
  const { getPreference } = yield* Effect.promise(() => import("./profile"))
  return yield* Effect.sync(() => getPreference(key))
})

const listPreferencesEff = Effect.fn("Memory.listPreferences")(function* (category?: string) {
  const { listPreferences } = yield* Effect.promise(() => import("./profile"))
  return yield* Effect.sync(() => listPreferences(category))
})

const cleanupExpiredEff = Effect.fn("Memory.cleanupExpired")(function* () {
  const { cleanupExpired } = yield* Effect.promise(() => import("./cleanup"))
  return yield* Effect.sync(() => cleanupExpired())
})

const runReflectionEff = Effect.fn("Memory.runReflection")(function* () {
  const { runReflection } = yield* Effect.promise(() => import("./reflection"))
  return yield* Effect.promise(() => runReflection())
})
```

**Step 2: Update index.ts**

```typescript
export * as Memory from "./service"
export * as MemoryEntities from "./entities"
export * as MemoryClassification from "./classification"
export * as MemoryVectors from "./vectors"
export * as MemoryProfile from "./profile"
```

**Step 3: Run all tests**

```bash
cd packages/opencode && bun test test/memory/
```

**Step 4: Commit**

```bash
git add packages/opencode/src/memory/service.ts packages/opencode/src/memory/index.ts
git commit -m "feat(memory): integrate profile, cleanup, and reflection into service"
```

---

## Self-Review

- [x] **Phase 1+2 compatibility:** Profile and reflection modules only add to existing system, don't modify Phase 1/2 interfaces
- [x] **No placeholders:** All code blocks complete
- [x] **Interface consistency:** `upsertPreference`/`getPreference`/`listPreferences` signatures consistent across tasks
- [ ] **To verify after implementation:** `bun test test/memory/` should show 240+ passing
