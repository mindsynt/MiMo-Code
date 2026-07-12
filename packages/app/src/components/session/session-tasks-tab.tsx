import { createEffect, createMemo, For, onMount, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { ScrollView } from "@mimo-ai/ui/scroll-view"
import { Icon } from "@mimo-ai/ui/icon"
import type { Todo } from "@mimo-ai/sdk/v2/client"

type TodoItem = {
  sessionID: string
  sessionTitle: string
  todo: Todo
}

const STATUS_KEYS: Record<string, string> = {
  pending: "session.tasks.status.pending",
  in_progress: "session.tasks.status.in_progress",
  completed: "session.tasks.status.completed",
  cancelled: "session.tasks.status.cancelled",
}

const STATUS_ICONS: Record<string, "circle-x" | "circle-check" | "circle-ban-sign"> = {
  pending: "circle-x",
  in_progress: "circle-check",
  completed: "circle-check",
  cancelled: "circle-ban-sign",
}

function sessionTitle(session: { title?: string; id: string } | undefined) {
  if (!session) return ""
  return session.title ?? session.id
}

/**
 * 调用 sync 上下文的 todo 获取方法。
 * createSimpleContext 的泛型推断存在限制，该方法实际存在于 sync 的返回对象中
 * （见 sync.tsx line 517），此处绕过 TS 推断以访问。
 */
const syncTodo = (sync: ReturnType<typeof useSync>, sessionID: string) => {
  return (sync as { todo?: (id: string) => Promise<void> }).todo?.(sessionID) ?? Promise.resolve()
}

export function SessionTasksTab(props: { onCount?: (count: number) => void }) {
  const sync = useSync()
  const language = useLanguage()

  onMount(() => {
    const sessions = sync.data.session ?? []
    for (const session of sessions) {
      const todos = sync.data.todo[session.id]
      if (todos === undefined) syncTodo(sync, session.id)
    }
  })

  const allTodos = createMemo(() => {
    const sessions = sync.data.session ?? []
    const statusOrder = ["pending", "in_progress", "completed", "cancelled"]
    const grouped: Record<string, TodoItem[]> = {}
    for (const key of statusOrder) grouped[key] = []

    for (const session of sessions) {
      const todos = sync.data.todo[session.id] ?? []
      for (const todo of todos) {
        const status = todo.status || "pending"
        const list = grouped[status]
        if (list) {
          list.push({
            sessionID: session.id,
            sessionTitle: sessionTitle(session),
            todo,
          })
        }
      }
    }
    return grouped
  })

  const orderedStatuses = createMemo(() => {
    const order = ["pending", "in_progress", "completed", "cancelled"]
    return order.filter((s) => (allTodos()[s]?.length ?? 0) > 0)
  })

  const total = createMemo(() => {
    let n = 0
    for (const list of Object.values(allTodos())) n += list.length
    return n
  })

  const sessionID = createMemo(() => sync.data.session?.find(s => s.time.archived === undefined)?.id)
  const activeGoal = createMemo(() => {
    const id = sessionID()
    if (!id) return undefined
    const goal = sync.data.session_goal?.[id]
    return goal?.condition
  })

  const allTasks = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const tasks = sync.data.task?.[id]
    if (!tasks || tasks.length === 0) return []
    return tasks
  })

  const allActors = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.actor?.[id] ?? []
  })

  createEffect(() => props.onCount?.(total()))

  return (
    <div class="h-full flex flex-col overflow-hidden" data-component="session-review">
      <ScrollView class="flex-1">
        <div class="px-3 pt-3 pb-12 flex flex-col gap-3">
          {/* Goal 状态指示器 */}
          <Show when={activeGoal()}>
            {(goal) => (
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-weak-base bg-surface-raised-base">
                <Icon name="circle-check" size="small" class="text-icon-info-base shrink-0" />
                <div class="flex flex-col min-w-0">
                  <span class="text-12-medium text-text-strong truncate">{language.t("session.goal.title")}</span>
                  <span class="text-12-regular text-text-weak truncate">{goal()}</span>
                </div>
              </div>
            )}
          </Show>

          {/* Task 列表 */}
          <Show when={allTasks().length > 0}>
            <div class="flex flex-col rounded-lg border border-border-base overflow-hidden bg-background-base">
              <div class="h-8 flex items-center gap-x-1.5 px-3 border-b border-border-base bg-surface-raised-base">
                <Icon name="circle-check" size="small" class="text-icon-info-base size-4 shrink-0" />
                <span class="text-12-medium text-text-strong uppercase tracking-wider">
                  {language.t("session.tasks.title")}
                </span>
                <span class="text-12-medium text-text-base">({allTasks().length})</span>
              </div>
              <For each={allTasks()}>
                {(task) => {
                  const statusColor = () => {
                    if (task.status === "done") return "text-icon-success-base"
                    if (task.status === "in_progress") return "text-icon-info-base"
                    if (task.status === "blocked") return "text-icon-warning-base"
                    if (task.status === "abandoned") return "text-text-weak"
                    return "text-text-weak"
                  }
                  return (
                    <div class="group w-full min-w-0 min-h-8 flex items-center justify-start gap-x-2 px-3 py-1.5 hover:bg-surface-raised-base-hover transition-colors border-b border-border-weaker-base last:border-b-0 bg-background-base">
                      <div class={`size-2 shrink-0 rounded-full ${statusColor()} bg-current`} />
                      <div class="flex-1 min-w-0">
                        <div class="text-13-medium whitespace-nowrap truncate text-text-strong">{task.summary}</div>
                        <Show when={task.owner}>
                          <div class="text-11-regular text-text-weak truncate">{task.owner}</div>
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>

          {/* Sub-agent 列表 */}
          <Show when={allActors().length > 0}>
            <div class="flex flex-col rounded-lg border border-border-base overflow-hidden bg-background-base">
              <div class="h-8 flex items-center gap-x-1.5 px-3 border-b border-border-base bg-surface-raised-base">
                <Icon name="task" size="small" class="text-icon-info-base size-4 shrink-0" />
                <span class="text-12-medium text-text-strong uppercase tracking-wider">Sub-agents</span>
                <span class="text-12-medium text-text-base">({allActors().length})</span>
              </div>
              <For each={allActors()}>
                {(actor) => (
                  <div class="group w-full min-w-0 min-h-8 flex items-center justify-start gap-x-2 px-3 py-1.5 hover:bg-surface-raised-base-hover transition-colors border-b border-border-weaker-base last:border-b-0 bg-background-base">
                    <div class={`size-2 shrink-0 rounded-full ${
                      actor.status === "running" || actor.status === "completed" ? "bg-icon-success-base" :
                      actor.status === "failed" || actor.status === "cancelled" ? "bg-icon-critical-base" :
                      "bg-text-weaker"
                    }`} />
                    <div class="flex-1 min-w-0">
                      <div class="text-13-medium whitespace-nowrap truncate text-text-strong">{actor.agent}: {actor.description}</div>
                      <div class="text-11-regular text-text-weak truncate">{actor.status} · {actor.turn_count} turns</div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show
            when={total() > 0}
            fallback={
              <div class="text-12-regular text-text-weak px-1.5 py-1">
                {language.t("session.tasks.empty")}
              </div>
            }
          >
            <For each={orderedStatuses()}>
              {(status) => (
                <div class="flex flex-col rounded-lg border border-border-base overflow-hidden bg-background-base">
                  <div class="h-8 flex items-center gap-x-1.5 px-3 border-b border-border-base bg-surface-raised-base">
                    <Icon
                      name={STATUS_ICONS[status]}
                      size="small"
                      class="size-4 shrink-0"
                      classList={{
                        "text-icon-success-base": status === "completed",
                        "text-icon-warning-base": status === "pending",
                        "text-icon-info-base": status === "in_progress",
                        "text-text-weak": status === "cancelled",
                      }}
                    />
                    <span class="text-12-medium text-text-strong uppercase tracking-wider">
                      {language.t(STATUS_KEYS[status] as Parameters<typeof language.t>[0])}
                    </span>
                    <span class="text-12-medium text-text-base">({allTodos()[status]!.length})</span>
                  </div>
                  <For each={allTodos()[status]}>
                    {(item) => (
                      <div class="group w-full min-w-0 h-8 flex items-center justify-start gap-x-2 px-3 py-0 hover:bg-surface-raised-base-hover transition-colors border-b border-border-weaker-base last:border-b-0 bg-background-base">
                        <Icon
                          name={STATUS_ICONS[status]}
                          size="small"
                          class="size-4 shrink-0"
                          classList={{
                            "text-icon-success-base": status === "completed",
                            "text-icon-warning-base": status === "pending",
                            "text-icon-info-base": status === "in_progress",
                            "text-text-weak": status === "cancelled",
                          }}
                        />
                        <span class="flex-1 min-w-0 text-13-medium whitespace-nowrap truncate text-text-strong">
                          {item.todo.content}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
