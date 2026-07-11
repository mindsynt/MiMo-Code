import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { TaskRegistry } from "../../src/task/registry"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

afterEach(async () => {
  await Instance.disposeAll()
})

const env = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  Bus.defaultLayer,
  Session.defaultLayer,
  TaskRegistry.defaultLayer,
)

const it = testEffect(env)

const seedSession = Effect.fn("Test.seedSession")(function* () {
  const session = yield* Session.Service
  return yield* session.create({ title: "Test" })
})

describe("TaskRegistry.create: ID generation", () => {
  it.live("sequential top-level IDs: T1, T2, T3, T4", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()

        const ids = yield* Effect.all([
          reg.create({ session_id: sess.id, summary: "a" }),
          reg.create({ session_id: sess.id, summary: "b" }),
          reg.create({ session_id: sess.id, summary: "c" }),
          reg.create({ session_id: sess.id, summary: "d" }),
        ])
        expect(ids.map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4"])
      }),
    ),
  )

  it.live("subtasks under same parent: T1.1, T1.2, T1.3", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const parent = yield* reg.create({ session_id: sess.id, summary: "parent" })

        const subs = yield* Effect.all([
          reg.create({ session_id: sess.id, summary: "child1", parent_id: parent.id }),
          reg.create({ session_id: sess.id, summary: "child2", parent_id: parent.id }),
          reg.create({ session_id: sess.id, summary: "child3", parent_id: parent.id }),
        ])
        expect(subs.map((t) => t.id)).toEqual(["T1.1", "T1.2", "T1.3"])
      }),
    ),
  )

  it.live("deep nested subtasks: T1.1.1, T1.1.2", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const parent = yield* reg.create({ session_id: sess.id, summary: "parent" })
        const child = yield* reg.create({ session_id: sess.id, summary: "child", parent_id: parent.id })

        const grandchild1 = yield* reg.create({ session_id: sess.id, summary: "gc1", parent_id: child.id })
        const grandchild2 = yield* reg.create({ session_id: sess.id, summary: "gc2", parent_id: child.id })
        expect(grandchild1.id).toBe("T1.1.1")
        expect(grandchild2.id).toBe("T1.1.2")
      }),
    ),
  )

  it.live("different parents have independent subtask numbering", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const p1 = yield* reg.create({ session_id: sess.id, summary: "parent1" })
        const p2 = yield* reg.create({ session_id: sess.id, summary: "parent2" })

        const s1 = yield* reg.create({ session_id: sess.id, summary: "child of p1", parent_id: p1.id })
        const s2 = yield* reg.create({ session_id: sess.id, summary: "child of p2", parent_id: p2.id })
        expect(s1.id).toBe("T1.1")
        expect(s2.id).toBe("T2.1")
      }),
    ),
  )

  it.live("same parent can have grandchildren under different children", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const parent = yield* reg.create({ session_id: sess.id, summary: "parent" })
        const c1 = yield* reg.create({ session_id: sess.id, summary: "c1", parent_id: parent.id })
        const c2 = yield* reg.create({ session_id: sess.id, summary: "c2", parent_id: parent.id })

        const gc1 = yield* reg.create({ session_id: sess.id, summary: "gc1", parent_id: c1.id })
        const gc2 = yield* reg.create({ session_id: sess.id, summary: "gc2", parent_id: c2.id })
        expect(gc1.id).toBe("T1.1.1")
        expect(gc2.id).toBe("T1.2.1")
      }),
    ),
  )

  it.live("IDs are not reused after task is abandoned", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t1 = yield* reg.create({ session_id: sess.id, summary: "will abandon" })
        expect(t1.id).toBe("T1")
        yield* reg.abandon({ session_id: sess.id, id: t1.id })

        const t2 = yield* reg.create({ session_id: sess.id, summary: "new task" })
        // ID generation increments from existing IDs; abandoned task still has its ID in DB
        // so next ID should be T2, not reuse T1
        expect(t2.id).toBe("T2")
      }),
    ),
  )
})
