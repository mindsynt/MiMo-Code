import { Show, createMemo, For } from "solid-js"
import { ContentCode } from "../../share/content-code"
import { ContentText } from "../../share/content-text"
import { ContentError } from "../../share/content-error"
import { ContentMarkdown } from "../../share/content-markdown"
import { register } from "./ToolDispatch"
import type { ToolProps } from "./ToolDispatch"

export const WebFetchTool = (props: ToolProps) => (
  <>
    <div data-component="tool-title"><span data-slot="name">Fetch</span><span data-slot="target">{props.state.input.url}</span></div>
    <div data-component="tool-result">
      <Show when={props.state.metadata?.error}>
        <ContentError><pre><span style="color:var(--danger);font-weight:500;">Error</span> {props.state.output}</pre></ContentError>
      </Show>
      <Show when={!props.state.metadata?.error && props.state.output}>
        <ContentCode lang={props.state.input.format || "text"} code={props.state.output} />
      </Show>
    </div>
  </>
)
register("webfetch", WebFetchTool)

interface Todo {
  id: string; content: string; status: "pending" | "in_progress" | "completed"
}

export const TodoWriteTool = (props: ToolProps) => {
  const priority: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }
  const todos = createMemo(() =>
    ((props.state.input?.todos ?? []) as Todo[]).slice().sort((a, b) => priority[a.status] - priority[b.status])
  )
  const starting = () => todos().every((t: Todo) => t.status === "pending")
  const finished = () => todos().every((t: Todo) => t.status === "completed")
  return (
    <>
      <div data-component="tool-title">
        <span data-slot="name">{starting() ? "Creating plan" : finished() ? "Completing plan" : "Updating plan"}</span>
      </div>
      <Show when={todos().length > 0}>
        <ul data-component="todos">
          <For each={todos()}>{(todo) => (
            <li data-slot="item" data-status={todo.status}><span></span>{todo.content}</li>
          )}</For>
        </ul>
      </Show>
    </>
  )
}
register("todowrite", TodoWriteTool)

export const TaskTool = (props: ToolProps) => (
  <>
    <div data-component="tool-title"><span data-slot="name">Task</span><span data-slot="target">{props.state.input.description}</span></div>
    <div data-component="tool-input">&ldquo;{props.state.input.prompt}&rdquo;</div>
    <div data-component="tool-output"><ContentMarkdown expand text={props.state.output} /></div>
  </>
)
register("task", TaskTool)

export const SearchTool = (props: ToolProps) => {
  const query = typeof props.state.input.query === "string" ? props.state.input.query : ""
  const numResults = props.state.metadata?.numResults ?? props.state.metadata?.results
  return (
    <>
      <div data-component="tool-title">
        <span data-slot="name">{props.tool === "websearch" ? "Thinking" : "Code Search"}</span>
        <span data-slot="target">&ldquo;{query}&rdquo;</span>
        <Show when={numResults}><span style="color:var(--text-dimmed);font-size:var(--text-xs);">({numResults} results)</span></Show>
      </div>
      <Show when={props.state.output}>
        <div data-component="tool-result"><ContentText expand compact text={props.state.output} /></div>
      </Show>
    </>
  )
}
register("websearch", SearchTool)
register("codesearch", SearchTool)

export const QuestionTool = (props: ToolProps) => {
  const questions = (props.state.input?.questions ?? []) as Array<{ question: string }>
  const answers = (props.state.metadata?.answers ?? []) as string[][]
  return (
    <div data-component="tool-title">
      <span data-slot="name">Thinking</span>
      <span data-slot="target">{questions.length} questions</span>
      <Show when={answers.length > 0}>
        <For each={questions}>{(q, i) => (
          <div style="font-size:var(--text-xs);color:var(--text-dimmed);padding:0.25rem 0;">
            {q.question} → {answers[i()]?.join(", ") || "(no answer)"}
          </div>
        )}</For>
      </Show>
    </div>
  )
}
register("question", QuestionTool)

export const SkillTool = (props: ToolProps) => (
  <div data-component="tool-title">
    <span data-slot="name">Skill</span>
    <span data-slot="target">&ldquo;{typeof props.state.input.name === "string" ? props.state.input.name : "Running..."}&rdquo;</span>
  </div>
)
register("skill", SkillTool)

interface WorkflowCounters { running: number; succeeded: number; failed: number }
export const WorkflowTool = (props: ToolProps) => {
  const isRun = !props.state.input.operation || props.state.input.operation === "run"
  const counters = props.state.metadata?.counters as WorkflowCounters | undefined
  const currentPhase = props.state.metadata?.currentPhase as string | undefined
  if (!isRun) return (
    <div data-component="tool-title">
      <span data-slot="name">workflow {props.state.input.operation || ""}</span>
    </div>
  )
  return (
    <div data-component="tool-title">
      <span data-slot="name">⚡ {typeof props.state.input.name === "string" ? props.state.input.name : "Workflow"}</span>
      <Show when={props.state.metadata?.status}><span data-slot="target">{String(props.state.metadata?.status)}</span></Show>
      <Show when={currentPhase}><span style="color:var(--text-dimmed);font-size:var(--text-xs);">· {currentPhase}</span></Show>
      <Show when={counters}>
        <span style="display:inline-flex;gap:0.375rem;font-size:0.75rem;color:var(--text-dimmed);margin-left:0.5rem;">
          <span style="color:var(--success)">{counters!.succeeded}✓</span>
          <span style={{ color: counters!.failed > 0 ? "var(--danger)" : "" }}>{counters!.failed}✗</span>
          <span style={{ color: counters!.running > 0 ? "var(--warning)" : "" }}>{counters!.running}↻</span>
        </span>
      </Show>
    </div>
  )
}
register("workflow", WorkflowTool)

export const ApplyPatchTool = (props: ToolProps) => {
  const files = (props.state.metadata?.files ?? props.state.input?.files ?? []) as Array<{ relativePath: string; additions?: number; deletions?: number }>
  return (
    <>
      <div data-component="tool-title"><span data-slot="name">Patch</span><span data-slot="target">{files.length} file{files.length !== 1 ? "s" : ""}</span></div>
      <For each={files}>{(file) => (
        <div style="font-size:var(--text-xs);color:var(--text-dimmed);padding:0.125rem 0;">
          {file.relativePath}
          <Show when={file.additions}> <span style="color:var(--success)">+{file.additions}</span></Show>
          <Show when={file.deletions}> <span style="color:var(--danger)">-{file.deletions}</span></Show>
        </div>
      )}</For>
    </>
  )
}
register("apply_patch", ApplyPatchTool)

export const ActorTool = (props: ToolProps) => {
  const input = props.state.input as { operation?: { action?: string; description?: string }; description?: string; action?: string }
  const action = input?.operation?.action ?? input?.action
  const description = (input?.operation?.description ?? input?.description) || ""
  return (
    <div data-component="tool-title">
      <span data-slot="name">Task</span>
      <span data-slot="target">{action === "cancel" ? "Cancelling" : action === "wait" ? "Waiting" : "Running"} — {description}</span>
      <Show when={props.state.metadata?.sessionId}>
        <a href={`/s/${props.state.metadata?.sessionId}`} target="_blank" rel="noopener noreferrer"
           style="font-size:0.75rem;color:var(--accent);margin-left:0.25rem;">open ↗</a>
      </Show>
    </div>
  )
}
register("actor", ActorTool)

export const FallbackTool = (props: ToolProps) => (
  <>
    <div data-component="tool-title"><span data-slot="name">{props.tool}</span></div>
    <Show when={props.state.output}>
      <div data-component="tool-result"><ContentText compact text={props.state.output} data-size="sm" data-color="dimmed" /></div>
    </Show>
  </>
)

export function registerAllTools() {
  // Already registered via `register(...)` calls above
}
