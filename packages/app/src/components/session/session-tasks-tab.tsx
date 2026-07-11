import { createMemo, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { ScrollView } from "@mimo-ai/ui/scroll-view"
import type { Todo } from "@mimo-ai/sdk/v2/client"

type TodoItem = {
  sessionID: string
  sessionTitle: string
  todo: Todo
}

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  cancelled: 3,
}

const STATUS_KEYS: Record<string, string> = {
  pending: "session.tasks.status.pending",
  in_progress: "session.tasks.status.in_progress",
  completed: "session.tasks.status.completed",
  cancelled: "session.tasks.status.cancelled",
}

function sessionTitle(session: { title?: string; id: string } | undefined) {
  if (!session) return ""
  return session.title ?? session.id
}

export function SessionTasksTab() {
  const sync = useSync()
  const language = useLanguage()

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

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <ScrollView class="flex-1">
        <div class="px-4 pt-4 pb-10 flex flex-col gap-5">
          <Show
            when={total() > 0}
            fallback={
              <div class="text-12-regular text-text-weak px-2">
                {language.t("session.tasks.empty" as Parameters<typeof language.t>[0])}
              </div>
            }
          >
            <For each={orderedStatuses()}>
              {(status) => (
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center gap-2 text-12-medium text-text-strong uppercase tracking-wider">
                    <span>{language.t(STATUS_KEYS[status] as Parameters<typeof language.t>[0])}</span>
                    <span class="text-text-weak">({allTodos()[status]!.length})</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <For each={allTodos()[status]}>
                      {(item) => (
                        <div class="flex flex-col px-2 py-1.5 rounded-md bg-surface-base">
                          <div class="text-12-regular text-text-strong">{item.todo.content}</div>
                          <Show when={item.sessionTitle}>
                            <div class="text-11-regular text-text-weak truncate mt-0.5">
                              {item.sessionTitle}
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}