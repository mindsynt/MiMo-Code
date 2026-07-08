# Phase 4: 集成与优化 Implementation Plan

**Goal:** Add configuration switches, wire them into pipeline components, add end-to-end integration test, and performance instrumentation.

**Architecture:** Extend the existing `memory` config struct with per-layer enable/disable flags. Each Phase 1/2/3 component checks its config before running. Add a comprehensive E2E test that exercises the full chain.

---

### Task 1: Config Schema

**Files:** Modify `packages/opencode/src/config/config.ts`

Add to the existing `memory` struct (around line 335):

```typescript
memory: Schema.optional(
  Schema.Struct({
    cc_index: Schema.optional(Schema.Boolean).annotate({ description: "..." }),
    // New:
    pipeline: Schema.optional(Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable classification + entity extraction pipeline (Phase 1). Default: true.",
      }),
    })),
    vectors: Schema.optional(Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable vector embedding storage and search (Phase 2). Default: true.",
      }),
    })),
    profile: Schema.optional(Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable user preference extraction (Phase 3). Default: true.",
      }),
    })),
    reflection: Schema.optional(Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable periodic reflection subagent (Phase 3). Default: true.",
      }),
      interval: Schema.optional(PositiveInt).annotate({
        description: "Reflection interval in checkpoint cycles. Default: 5.",
      }),
    })),
    cleanup: Schema.optional(Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Enable TTL-based cleanup of expired chunks/vectors. Default: true.",
      }),
      interval: Schema.optional(PositiveInt).annotate({
        description: "Cleanup interval in pipeline runs. Default: 50.",
      }),
    })),
  }),
),
```

Then wire config into components:

- `memory-pipeline.ts`: check `cfg.memory?.pipeline?.enabled` before running Phase A
- `memory-pipeline.ts`: check `cfg.memory?.vectors?.enabled` before chunk+embed
- `memory-pipeline.ts`: check `cfg.memory?.profile?.enabled` before classifyPersonal
- `prune.ts`: check `cfg.memory?.reflection?.enabled` before triggering reflection
- `memory-pipeline.ts`: check `cfg.memory?.cleanup?.enabled` before cleanupExpired

**Commit:** `git commit -m "feat(config): add memory pipeline/vector/profile/reflection/cleanup config"`

---

### Task 2: Wire Config into Pipeline

**Files:** Modify `packages/opencode/src/session/memory-pipeline.ts`, `packages/opencode/src/session/prune.ts`

In `memory-pipeline.ts`, wrap each Phase section with config check:

```typescript
export async function runMemoryPipeline(input: { ... }): Promise<void> {
  const { getConfig } = await import("../config")
  const cfg = getConfig()
  const memCfg = cfg.memory ?? {}

  // Phase A — classification + entities
  if (memCfg.pipeline?.enabled !== false) {
    // existing Phase A code
  }

  // Phase 2 — chunk + embed
  if (memCfg.vectors?.enabled !== false && allEntities.length > 0) {
    // existing chunk+embed code, wrapped in this check
  }

  // Profile extraction
  if (memCfg.profile?.enabled !== false) {
    // existing classifyPersonal + upsertPreference code
  }

  // Cleanup
  pipelineRunCount++
  if (memCfg.cleanup?.enabled !== false && pipelineRunCount % (memCfg.cleanup?.interval ?? 50) === 0) {
    // cleanupExpired()
  }
}
```

In `prune.ts`:

```typescript
// reflection trigger
if (cfg.memory?.reflection?.enabled !== false) {
  reflectionCounter++
  if (reflectionCounter % (cfg.memory?.reflection?.interval ?? 5) === 0) {
    // runReflection()
  }
}
```

**Commit:** `git commit -m "feat(memory): wire config switches into pipeline and prune"`

---

### Task 3: End-to-End Integration Test

**Files:** Create `packages/opencode/test/memory/memory-e2e.test.ts`

A comprehensive test that exercises the full pipeline chain:

```typescript
import { describe, expect, test, beforeAll } from "bun:test"
import { Database } from "../../src/storage"
import { runMemoryPipeline } from "../../src/session/memory-pipeline"
import { EntityTable } from "../../src/memory/pipeline.sql"
import { ChunkTable } from "../../src/memory/vectors.sql"
import { ProfileTable } from "../../src/memory/profile.sql"
import { getVectorIndex, resetVectorIndex } from "../../src/memory/vectors"
import { queryEntity, traverseGraph } from "../../src/memory/entities"
import { getPreference } from "../../src/memory/profile"
import { eq } from "drizzle-orm"

beforeAll(() => {
  // Create all tables
  const db = Database.Client().$client
  db.run(`CREATE TABLE IF NOT EXISTS memory_entity (...)`) // simplified
  // ... create all necessary tables
})

describe("full pipeline E2E", () => {
  test("classify → extract entities → chunk → searchable via graph", async () => {
    resetVectorIndex()

    await runMemoryPipeline({
      sessionID: "e2e-test",
      text: "使用 `Bun.write()` 写入文件，必须用 const 声明变量",
      messageID: "e2e-msg-1",
    })

    await new Promise((r) => setTimeout(r, 500)) // wait for async

    // Verify entities created
    const entity = queryEntity("Bun.write")
    expect(entity).toBeDefined()
    expect(entity!.type).toBe("function")

    // Verify chunks created
    const chunks = Database.use((db) => db.select().from(ChunkTable).all())
    expect(chunks.length).toBeGreaterThan(0)

    // Verify graph queryable
    const paths = traverseGraph("Bun.write")
    expect(paths).toBeDefined()
  })

  test("extracts user preferences from text", async () => {
    await runMemoryPipeline({
      sessionID: "e2e-pref",
      text: "我喜欢用 Bun 而不是 npm",
      messageID: "e2e-pref-1",
    })

    await new Promise((r) => setTimeout(r, 200))
    const pref = getPreference("preferred_tool")
    expect(pref).toBeDefined()
    expect(pref!.value).toBe("Bun")
  })
})
```

**Commit:** `git commit -m "test(memory): end-to-end integration test"`

---

### Task 4: Performance Instrumentation

**Files:** Modify `packages/opencode/src/session/memory-pipeline.ts`

Add timing instrumentation to each pipeline phase:

```typescript
const start = performance.now()
// ... Phase A ...
const phaseAMs = Math.round(performance.now() - start)
log.debug("pipeline phase A", { tier, entities: allEntities.length, ms: phaseAMs })
```

The `log.debug` calls at key points already exist. Add latency warning:

```typescript
const totalMs = Math.round(performance.now() - start)
if (totalMs > 1000) {
  log.warn("memory pipeline exceeded 1s budget", { totalMs, sessionID: input.sessionID })
}
```

**Commit:** `git commit -m "perf(memory): add pipeline timing instrumentation"`
