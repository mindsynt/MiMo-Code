import { For, Show, onMount, onCleanup, createMemo, createSignal, Suspense } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { IconArrowDown, IconArrowRight } from "../icons"
import { IconOpencode } from "../icons/custom"
import { ShareI18nProvider, formatCurrency, formatNumber, normalizeLocale } from "../share/common"
import styles from "./session.module.css"
import type { MessageV2 } from "@mimo-ai/cli/session/message-v2"
import type { Message } from "@mimo-ai/cli/session/message"
import type { Session } from "@mimo-ai/cli/session/index"
import { Part, ProviderIcon } from "../share/part"

type MessageWithParts = MessageV2.Info & { parts: MessageV2.Part[] }
type Status = "disconnected" | "connecting" | "connected" | "error" | "reconnecting"

function statusText(s: [Status, string?], m: Record<string, string>): string {
  switch (s[0]) {
    case "connected": return m.status_connected_waiting
    case "connecting": return m.status_connecting
    case "disconnected": return m.status_disconnected
    case "reconnecting": return m.status_reconnecting
    case "error": return s[1] || m.status_error
    default: return m.status_unknown
  }
}

export function SessionView(props: {
  id: string
  api: string
  info: Session.Info
  messages: { locale: string } & Record<string, string>
}) {
  const [store, setStore] = createStore<{
    info?: Session.Info
    messages: Record<string, MessageWithParts>
  }>({
    info: {
      id: props.id,
      slug: props.info.slug,
      projectID: props.info.projectID,
      directory: props.info.directory,
      title: props.info.title,
      version: props.info.version,
      time: { created: props.info.time.created, updated: props.info.time.updated },
    },
    messages: {},
  })

  const [status, setStatus] = createSignal<[Status, string?]>(["disconnected"])
  const [expandedMsgs, setExpandedMsgs] = createStore<Record<string, boolean>>({})
  const params = new URLSearchParams(window.location.search)
  const debug = params.get("debug") === "true"
  const [showScroll, setShowScroll] = createSignal(false)
  const [isHover, setHover] = createSignal(false)
  const [nearBottom, setNearBottom] = createSignal(false)

  const msgs = createMemo(() => Object.values(store.messages).toSorted((a, b) => a.id?.localeCompare(b.id)))

  const data = createMemo(() => {
    const r = { models: {} as Record<string, string[]>, cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } }
    for (const msg of msgs()) {
      if (msg.role === "assistant") {
        r.cost += msg.cost
        r.tokens.input += msg.tokens.input
        r.tokens.output += msg.tokens.output
        r.tokens.reasoning += msg.tokens.reasoning
        r.models[`${msg.providerID} ${msg.modelID}`] = [msg.providerID, msg.modelID]
      }
    }
    return r
  })

  // WebSocket
  let sock: WebSocket | null = null
  let rt: number | undefined
  onMount(() => {
    if (!props.id) { setStatus(["error", props.messages.error_id_not_found]); return }
    const api = props.api
    if (!api) { setStatus(["error", props.messages.error_api_url_not_found]); return }

    const connect = () => {
      if (sock) sock.close()
      setStatus(["connecting"])
      const ws = api.replace(/^https?:\/\//, "wss://")
      sock = new WebSocket(`${ws}/share_poll?id=${props.id}`)
      sock.onopen = () => setStatus(["connected"])
      sock.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          const [root, type, ...splits] = d.key.split("/")
          if (root !== "session") return
          if (type === "info") { setStore("info", reconcile(d.content)); return }
          if (type === "message") {
            const [, mid] = splits
            if ("metadata" in d.content) d.content = fromV1(d.content)
            d.content.parts = d.content.parts ?? store.messages[mid]?.parts ?? []
            setStore("messages", mid, reconcile(d.content))
          }
          if (type === "part") {
            setStore("messages", d.content.messageID, "parts", (arr) => {
              const i = arr.findIndex((x) => x.id === d.content.id)
              if (i === -1) arr.push(d.content); else arr[i] = d.content
              return [...arr]
            })
          }
        } catch (err) { console.error("WS parse error", err) }
      }
      sock.onerror = () => setStatus(["error", props.messages.error_connection_failed])
      sock.onclose = () => {
        setStatus(["reconnecting"])
        clearTimeout(rt)
        rt = window.setTimeout(connect, 2000)
      }
    }
    connect()
    onCleanup(() => { if (sock) sock.close(); clearTimeout(rt) })
  })

  // Scroll
  let st: number | undefined
  let sentinel: HTMLElement | undefined
  let obs: IntersectionObserver | undefined
  onMount(() => {
    const el = document.createElement("div")
    el.style.cssText = "height:1px;position:absolute;bottom:100px;width:100%;pointer-events:none"
    document.body.appendChild(el)
    obs = new IntersectionObserver(([e]) => setNearBottom(e.isIntersecting))
    obs.observe(el)
    sentinel = el

    const fn = () => {
      const s = window.scrollY > 300 && !nearBottom()
      setShowScroll(s)
      if (st) clearTimeout(st)
      if (s) st = window.setTimeout(() => { if (!isHover()) setShowScroll(false) }, 4000)
      else if (!isHover()) setShowScroll(false)
    }
    window.addEventListener("scroll", fn)
    window.addEventListener("resize", fn)
    onCleanup(() => {
      window.removeEventListener("scroll", fn)
      window.removeEventListener("resize", fn)
      if (obs) obs.disconnect()
      if (sentinel) document.body.removeChild(sentinel)
      if (st) clearTimeout(st)
    })
  })

  return (
    <Show when={props.info}>
      <ShareI18nProvider messages={props.messages}>
        <div class={styles.root}>
          <div class={styles.body}>
            <div class={styles.main}>
              <div class={styles.stream}>
                <div class={styles["stream-inner"]}>
                  <div class={styles.header}>
                    <h1 class={styles["header-title"]}>{props.info?.title}</h1>
                    <div class={styles["header-details"]}>
                      <ul class={styles["header-stats"]}>
                        <li class={styles["stat-item"]}>
                          <span class={styles["stat-icon"]}><IconOpencode width={14} height={14} /></span>
                          <Show when={props.info?.version} fallback="v0.0.1"><span>v{props.info?.version}</span></Show>
                        </li>
                        <For each={Object.values(data().models)}>
                          {([provider, model]) => (
                            <li class={styles["stat-item"]}>
                              <span class={styles["stat-icon"]} title={provider}><ProviderIcon model={model} size={14} /></span>
                              <span class={styles["stat-model"]}>{model}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  </div>

                  <Show when={msgs().length > 0} fallback={<p style={{ color: "var(--text-dimmed)", "font-size": "var(--text-sm)" }}>{props.messages.waiting_for_messages}</p>}>
                    <For each={msgs()}>
                      {(msg, mi) => {
                        const exp = createMemo(() => expandedMsgs[msg.id] !== false)
                        const toggle = () => setExpandedMsgs(msg.id, !exp())
                        const fp = createMemo(() => msg.parts.filter((x, i) => {
                          if (x.type === "step-start" && i > 0) return false
                          if (x.type === "snapshot" || x.type === "patch" || x.type === "step-finish") return false
                          if (x.type === "text" && (x.synthetic === true || !x.text)) return false
                          if (x.type === "tool" && (x.state.status === "pending" || x.state.status === "running")) return false
                          return true
                        }))
                        return (
                          <Suspense>
                            <Show when={msg.role === "assistant"}>
                              <div class={styles["agent-toggle"]} role="button" tabIndex={0} onClick={toggle}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle() } }}>
                                <Show when={exp()} fallback={<IconArrowRight width={14} height={14} />}>
                                  <IconArrowDown width={14} height={14} />
                                </Show>
                                <span>{msg.agent ?? "assistant"}</span>
                                <Show when={msg.modelID}><span class={styles["agent-toggle-model"]}>{msg.modelID}</span></Show>
                              </div>
                            </Show>
                            <Show when={exp() || msg.role !== "assistant"}>
                              <For each={fp()}>
                                {(part, pi) => <Part last={msgs().length === mi() + 1 && fp().length === pi() + 1} part={part} index={pi()} message={msg} />}
                              </For>
                            </Show>
                          </Suspense>
                        )
                      }}
                    </For>

                    <div class={styles.summary}>
                      <span class={styles["summary-indicator"]} data-status={status()[0]} />
                      <span class={styles["summary-text"]}>{statusText(status(), props.messages)}</span>
                      <ul class={styles["summary-stats"]}>
                        <li class={styles["summary-stat"]}><span class={styles["summary-stat-label"]}>{props.messages.cost}</span>{formatCurrency(data().cost, props.messages.locale)}</li>
                        <li class={styles["summary-stat"]}><span class={styles["summary-stat-label"]}>{props.messages.input_tokens}</span>{formatNumber(data().tokens.input, props.messages.locale)}</li>
                        <li class={styles["summary-stat"]}><span class={styles["summary-stat-label"]}>{props.messages.output_tokens}</span>{formatNumber(data().tokens.output, props.messages.locale)}</li>
                        <li class={styles["summary-stat"]}><span class={styles["summary-stat-label"]}>{props.messages.reasoning_tokens}</span>{formatNumber(data().tokens.reasoning, props.messages.locale)}</li>
                      </ul>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>

          <Show when={debug && msgs().length > 0}>
            <div style={{ margin: "1rem", padding: "1rem", border: "1px solid var(--border)" }}>
              <strong>{props.messages.debug_key}:</strong>
              <For each={msgs()}>{(msg) => <pre style={{ "font-size": "var(--text-xs)" }}>{JSON.stringify(msg, null, 2)}</pre>}</For>
            </div>
          </Show>

          <Show when={showScroll()}>
            <button type="button" class={styles["scroll-button"]}
              onClick={() => document.body.scrollIntoView({ behavior: "smooth", block: "end" })}
              onMouseEnter={() => { setHover(true); if (st) clearTimeout(st) }}
              onMouseLeave={() => { setHover(false); if (showScroll()) st = window.setTimeout(() => { if (!isHover()) setShowScroll(false) }, 3000) }}
              title={props.messages.scroll_to_bottom}>
              <IconArrowDown width={18} height={18} />
            </button>
          </Show>
        </div>
      </ShareI18nProvider>
    </Show>
  )
}

function fromV1(v1: Message.Info): MessageWithParts {
  if (v1.role === "assistant") {
    return {
      id: v1.id, sessionID: v1.metadata.sessionID, role: "assistant", parentID: "", agent: "build",
      time: { created: v1.metadata.time.created, completed: v1.metadata.time.completed },
      cost: v1.metadata.assistant!.cost, path: v1.metadata.assistant!.path, summary: v1.metadata.assistant!.summary,
      tokens: v1.metadata.assistant!.tokens ?? { input: 0, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 },
      modelID: v1.metadata.assistant!.modelID, providerID: v1.metadata.assistant!.providerID, mode: "build", error: v1.metadata.error,
      parts: v1.parts.flatMap((part, i): MessageV2.Part[] => {
        const b = { id: i.toString(), messageID: v1.id, sessionID: v1.metadata.sessionID }
        if (part.type === "text") return [{ ...b, type: "text", text: part.text }]
        if (part.type === "step-start") return [{ ...b, type: "step-start" }]
        if (part.type === "tool-invocation") {
          return [{ ...b, type: "tool", callID: part.toolInvocation.toolCallId, tool: part.toolInvocation.toolName,
            state: (() => {
              if (part.toolInvocation.state === "partial-call") return { status: "pending", input: {}, raw: "" }
              const { title, time, ...meta } = v1.metadata.tool[part.toolInvocation.toolCallId]
              if (part.toolInvocation.state === "call") return { status: "running", input: part.toolInvocation.args, time: { start: time.start } }
              if (part.toolInvocation.state === "result") return { status: "completed", input: part.toolInvocation.args, output: part.toolInvocation.result, title, time, metadata: meta }
              throw new Error("unknown tool invocation state")
            })(),
          }]
        }
        return []
      }),
    }
  }
  if (v1.role === "user") {
    return {
      id: v1.id, sessionID: v1.metadata.sessionID, role: "user", agent: "user",
      model: { providerID: "", modelID: "" },
      time: { created: v1.metadata.time.created },
      parts: v1.parts.flatMap((part, i): MessageV2.Part[] => {
        const b = { id: i.toString(), messageID: v1.id, sessionID: v1.metadata.sessionID }
        if (part.type === "text") return [{ ...b, type: "text", text: part.text }]
        if (part.type === "file") return [{ ...b, type: "file", mime: part.mediaType, filename: part.filename, url: part.url }]
        return []
      }),
    }
  }
  throw new Error("unknown message type")
}
