import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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

const STATUS_ICONS: Record<string, string> = {
  pending: "circle-x",
  in_progress: "circle-check",
  completed: "circle-check",
  cancelled: "circle-ban-sign",
}

function sessionTitle(session: { title?: string; id: string } | undefined) {
  if (!session) return ""
  return session.title ?? session.id
}

const syncTodo = (sync: ReturnType<typeof useSync>, sessionID: string) => {
  const s: any = sync
  return s.todo?.(sessionID) ?? Promise.resolve()
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

  createEffect(() => props.onCount?.(total()))

  return (
    <div class="h-full flex flex-col overflow-hidden" data-component="session-review">
      <ScrollView class="flex-1">
        <div class="px-3 pt-3 pb-12 flex flex-col gap-3">
          <Show
            when={total() > 0}
            fallback={
              <div class="text-12-regular text-text-weak px-1.5 py-1">
                {language.t("session.tasks.empty" as Parameters<typeof language.t>[0])}
              </div>
            }
          >
            <For each={orderedStatuses()}>
              {(status) => (
                <div class="flex flex-col rounded-lg border border-border-base overflow-hidden bg-background-base">
                  <div class="h-8 flex items-center gap-x-1.5 px-3 border-b border-border-base bg-surface-raised-base">
                    <Icon
                      name={STATUS_ICONS[status] as any}
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
                          name={STATUS_ICONS[status] as any}
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
