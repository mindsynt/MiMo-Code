import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { TaskRegistry } from "../../src/task/registry"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { isRecoverableError } from "../../src/tool/recoverable"
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

describe("TaskRegistry.create", () => {
  it.live("creates a top-level task with id T1", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()

        const task = yield* reg.create({
          session_id: sess.id,
          summary: "Refactor auth",
        })
        expect(task.id).toBe("T1")
        expect(task.status).toBe("open")
        expect(task.parent_task_id).toBeUndefined()
      }),
    ),
  )

  it.live("creates sequential top-level ids T1, T2, T3", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()

        const t1 = yield* reg.create({ session_id: sess.id, summary: "a" })
        const t2 = yield* reg.create({ session_id: sess.id, summary: "b" })
        const t3 = yield* reg.create({ session_id: sess.id, summary: "c" })
        expect(t1.id).toBe("T1")
        expect(t2.id).toBe("T2")
        expect(t3.id).toBe("T3")
      }),
    ),
  )

  it.live("creates subtask T1.1 under T1", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()

        const t1 = yield* reg.create({ session_id: sess.id, summary: "parent" })
        const sub = yield* reg.create({ session_id: sess.id, summary: "child", parent_id: t1.id })
        expect(sub.id).toBe("T1.1")
        expect(sub.parent_task_id).toBe("T1")
      }),
    ),
  )

  it.live("emits 'created' task_event on create", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "x" })
        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(1)
        expect(events[0].kind).toBe("created")
      }),
    ),
  )

  it.live("two sessions can each have a T1 without colliding", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const a = yield* seedSession()
        const b = yield* seedSession()

        const ta = yield* reg.create({ session_id: a.id, summary: "in A" })
        const tb = yield* reg.create({ session_id: b.id, summary: "in B" })
        expect(ta.id).toBe("T1")
        expect(tb.id).toBe("T1")
        expect(ta.session_id).toBe(a.id)
        expect(tb.session_id).toBe(b.id)
      }),
    ),
  )
})

describe("TaskRegistry.start", () => {
  it.live("transitions task from open to in_progress", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        const started = yield* reg.start({ session_id: sess.id, id: t.id })
        expect(started.status).toBe("in_progress")
        expect(started.owner).toBeUndefined()
      }),
    ),
  )

  it.live("sets owner when provided", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        const started = yield* reg.start({ session_id: sess.id, id: t.id, owner: "agent-1" })
        expect(started.status).toBe("in_progress")
        expect(started.owner).toBe("agent-1")
      }),
    ),
  )

  it.live("refuses to start a done task", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.done({ session_id: sess.id, id: t.id })

        const result = yield* reg.start({ session_id: sess.id, id: t.id })
        expect(result.status).toBe("done")
      }),
    ),
  )

  it.live("refuses to start an abandoned task", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.abandon({ session_id: sess.id, id: t.id })

        const result = yield* reg.start({ session_id: sess.id, id: t.id })
        expect(result.status).toBe("abandoned")
      }),
    ),
  )

  it.live("is idempotent for same owner when already in_progress", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.start({ session_id: sess.id, id: t.id, owner: "agent-1" })
        yield* reg.start({ session_id: sess.id, id: t.id, owner: "agent-1" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        const startedEvents = events.filter((e) => e.kind === "started")
        expect(startedEvents.length).toBe(1)
      }),
    ),
  )

  it.live("emits started event on first start", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.start({ session_id: sess.id, id: t.id, owner: "agent-1", event_summary: "beginning work" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(2)
        expect(events[0].kind).toBe("created")
        expect(events[1].kind).toBe("started")
        expect(events[1].summary).toBe("beginning work")
      }),
    ),
  )
})

describe("TaskRegistry.block", () => {
  it.live("transitions task to blocked", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        const blocked = yield* reg.block({ session_id: sess.id, id: t.id, event_summary: "waiting on review" })
        expect(blocked.status).toBe("blocked")
        expect(blocked.ended_at).toBeUndefined()
      }),
    ),
  )

  it.live("emits blocked event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.block({ session_id: sess.id, id: t.id, event_summary: "blocked reason" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(2)
        expect(events[1].kind).toBe("blocked")
        expect(events[1].summary).toBe("blocked reason")
      }),
    ),
  )
})

describe("TaskRegistry.unblock", () => {
  it.live("transitions task from blocked back to open", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.block({ session_id: sess.id, id: t.id })
        const unblocked = yield* reg.unblock({ session_id: sess.id, id: t.id, event_summary: "ready again" })
        expect(unblocked.status).toBe("open")
      }),
    ),
  )

  it.live("emits unblocked event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.block({ session_id: sess.id, id: t.id })
        yield* reg.unblock({ session_id: sess.id, id: t.id })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(3)
        expect(events[2].kind).toBe("unblocked")
      }),
    ),
  )
})

describe("TaskRegistry.done", () => {
  it.live("transitions task to done and sets timestamps", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        const done = yield* reg.done({ session_id: sess.id, id: t.id, event_summary: "completed" })
        expect(done.status).toBe("done")
        expect(done.ended_at).toBeDefined()
        expect(done.cleanup_after).toBeDefined()
        const cleanupAfter = done.cleanup_after as number
        const endedAt = done.ended_at as number
        expect(cleanupAfter).toBeGreaterThan(endedAt)
      }),
    ),
  )

  it.live("emits done event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.done({ session_id: sess.id, id: t.id, event_summary: "all done" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(2)
        expect(events[1].kind).toBe("done")
        expect(events[1].summary).toBe("all done")
      }),
    ),
  )
})

describe("TaskRegistry.abandon", () => {
  it.live("transitions task to abandoned and sets timestamps", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        const abandoned = yield* reg.abandon({ session_id: sess.id, id: t.id, event_summary: "dropped" })
        expect(abandoned.status).toBe("abandoned")
        expect(abandoned.ended_at).toBeDefined()
        expect(abandoned.cleanup_after).toBeDefined()
      }),
    ),
  )

  it.live("emits abandoned event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "a" })

        yield* reg.abandon({ session_id: sess.id, id: t.id, event_summary: "gave up" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(2)
        expect(events[1].kind).toBe("abandoned")
        expect(events[1].summary).toBe("gave up")
      }),
    ),
  )
})

describe("TaskRegistry.rename", () => {
  it.live("updates summary without changing status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "old" })

        const renamed = yield* reg.rename({ session_id: sess.id, id: t.id, summary: "new" })
        expect(renamed.summary).toBe("new")
        expect(renamed.status).toBe("open")
      }),
    ),
  )

  it.live("emits renamed event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "old" })

        yield* reg.rename({ session_id: sess.id, id: t.id, summary: "new name" })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.length).toBe(2)
        expect(events[1].kind).toBe("renamed")
        expect(events[1].summary).toBe("new name")
      }),
    ),
  )
})

describe("TaskRegistry.events sequence", () => {
  it.live("returns full lifecycle event chain in order", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t = yield* reg.create({ session_id: sess.id, summary: "full lifecycle" })

        yield* reg.start({ session_id: sess.id, id: t.id, owner: "a" })
        yield* reg.block({ session_id: sess.id, id: t.id })
        yield* reg.unblock({ session_id: sess.id, id: t.id })
        yield* reg.done({ session_id: sess.id, id: t.id })

        const events = yield* reg.events({ session_id: sess.id, task_id: t.id })
        expect(events.map((e) => e.kind)).toEqual(["created", "started", "blocked", "unblocked", "done"])
        expect(events.length).toBe(5)
      }),
    ),
  )
})

describe("TaskRegistry.list filters", () => {
  it.live("filters by status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        yield* reg.create({ session_id: sess.id, summary: "open1" })
        yield* reg.create({ session_id: sess.id, summary: "open2" })
        const t = yield* reg.create({ session_id: sess.id, summary: "will-be-done" })
        yield* reg.done({ session_id: sess.id, id: t.id })

        const openTasks = yield* reg.list({ session_id: sess.id, status: "open" })
        expect(openTasks.length).toBe(2)

        const doneTasks = yield* reg.list({ session_id: sess.id, status: "done", include_terminal: true })
        expect(doneTasks.length).toBe(1)
        expect(doneTasks[0].summary).toBe("will-be-done")
      }),
    ),
  )

  it.live("filters by owner", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t1 = yield* reg.create({ session_id: sess.id, summary: "owned", owner: "alice" })
        const t2 = yield* reg.create({ session_id: sess.id, summary: "unowned" })

        const aliceTasks = yield* reg.list({ session_id: sess.id, owner: "alice" })
        expect(aliceTasks.length).toBe(1)
        expect(aliceTasks[0].id).toBe(t1.id)
      }),
    ),
  )
})

describe("TaskRegistry not-found is agent-recoverable", () => {
  it.live("start on a nonexistent id dies with an actionable RecoverableError", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()

        const exit = yield* Effect.exit(reg.start({ session_id: sess.id, id: "T99" }))
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        const err = Cause.squash(exit.cause)
        expect(isRecoverableError(err)).toBe(true)
        expect((err as Error).message).toContain("task list")
      }),
    ),
  )
})

describe("TaskRegistry.list", () => {
  it.live("lists active tasks for a session by default", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.create({ session_id: sess.id, summary: "b" })

        const list = yield* reg.list({ session_id: sess.id })
        expect(list.length).toBe(2)
      }),
    ),
  )

  it.live("excludes terminal tasks by default", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t1 = yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.done({ session_id: sess.id, id: t1.id })
        yield* reg.create({ session_id: sess.id, summary: "b" })

        const list = yield* reg.list({ session_id: sess.id })
        expect(list.length).toBe(1)
        expect(list[0].summary).toBe("b")
      }),
    ),
  )

  it.live("includes terminal when include_terminal=true", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reg = yield* TaskRegistry.Service
        const sess = yield* seedSession()
        const t1 = yield* reg.create({ session_id: sess.id, summary: "a" })
        yield* reg.done({ session_id: sess.id, id: t1.id })

        const list = yield* reg.list({ session_id: sess.id, include_terminal: true })
        expect(list.length).toBe(1)
      }),
    ),
  )
})
