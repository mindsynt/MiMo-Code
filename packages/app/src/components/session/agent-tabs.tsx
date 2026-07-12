import { createMemo, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Icon } from "@mimo-ai/ui/icon"

interface AgentTabsProps {
  sessionID: string
  selected?: string
  onSelect?: (actorID: string | undefined) => void
}

export function AgentTabs(props: AgentTabsProps) {
  const sync = useSync()

  // 1. 从 actor 事件获取活跃子 agent（实时，刷新后可能为空）
  const liveActors = createMemo(() => {
    const list = sync.data.actor?.[props.sessionID] ?? []
    return list.filter((a) => a.mode === "subagent" || a.mode === "peer")
  })

  // 2. 从消息数据中检测所有出现过 agentID（刷新后仍可用）
  const detectedAgents = createMemo(() => {
    const msgs = sync.data.message?.[props.sessionID] ?? []
    const ids = new Map<string, { agentID: string; count: number }>()
    for (const m of msgs) {
      if (m.agentID && m.agentID.length > 0) {
        const existing = ids.get(m.agentID)
        if (existing) existing.count++
        else ids.set(m.agentID, { agentID: m.agentID, count: 1 })
      }
    }
    return [...ids.values()].sort((a, b) => b.count - a.count)
  })

  // 3. 合并：优先使用 live 数据，fallback 到消息检测
  const agentList = createMemo(() => {
    if (liveActors().length > 0) return liveActors().map((a) => ({ id: a.actor_id, name: a.agent, count: a.turn_count, status: a.status }))
    return detectedAgents().map((d) => ({ id: d.agentID, name: d.agentID, count: d.count, status: "completed" as const }))
  })

  const currentAgent = createMemo(() => agentList().find((a) => a.id === props.selected))

  return (
    <div class="flex flex-col gap-1">
      {/* Main 主线 */}
      <button
        onClick={() => props.onSelect?.(undefined)}
        class="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-13-medium transition-colors text-left"
        classList={{
          "bg-surface-raised-base text-text-strong": !props.selected,
          "text-text-weak hover:text-text-base hover:bg-surface-base-hover": !!props.selected,
        }}
      >
        <Icon name="circle-check" size="small" class="text-icon-success-base size-4 shrink-0" />
        <span>Main</span>
      </button>

      {/* 子 Agent 列表 */}
      {agentList().map((agent) => (
        <button
          onClick={() => props.onSelect?.(agent.id)}
          class="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-13-medium transition-colors text-left"
          classList={{
            "bg-surface-raised-base text-text-strong": props.selected === agent.id,
            "text-text-weak hover:text-text-base hover:bg-surface-base-hover": props.selected !== agent.id,
          }}
        >
          <span class={`size-2 rounded-full shrink-0 ${
            agent.status === "running" ? "bg-icon-info-base" :
            agent.status === "failed" || agent.status === "cancelled" ? "bg-icon-critical-base" :
            "bg-icon-success-base"
          }`} />
          <span class="min-w-0 flex-1 truncate">{agent.name}</span>
          <span class="text-11-regular text-text-weaker">{agent.count}</span>
        </button>
      ))}

      {/* 当前 agent 详情 */}
      <Show when={currentAgent()}>
        {(agent) => (
          <div class="px-3 pt-2 mt-1 border-t border-border-weaker-base text-11-regular text-text-weaker">
            <div class="flex items-center gap-2">
              <span>Status: {agent().status}</span>
              <span>·</span>
              <span>{agent().count} turns</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
