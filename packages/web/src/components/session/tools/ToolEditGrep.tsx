import { ContentDiff } from "../../share/content-diff"
import { ContentBash } from "../../share/content-bash"
import { ContentText } from "../../share/content-text"
import { ContentCode } from "../../share/content-code"
import { ContentError } from "../../share/content-error"
import { ContentMarkdown } from "../../share/content-markdown"
import { Show, For, createMemo } from "solid-js"
import { register } from "./ToolDispatch"
import type { ToolProps } from "./ToolDispatch"
import map from "lang-map"

function getShikiLang(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const langs = map.languages(ext)
  const type = langs?.[0]?.toLowerCase()
  const overrides: Record<string, string> = { conf: "shellscript" }
  return type ? (overrides[type] ?? type) : "plaintext"
}

function stripWD(filePath: string | undefined, workingDir: string | undefined) {
  if (!filePath || !workingDir) return filePath
  const prefix = workingDir.endsWith("/") ? workingDir : workingDir + "/"
  if (filePath === workingDir) return ""
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length)
  return filePath
}

export const EditTool = (props: ToolProps) => {
  const filePath = createMemo(() => stripWD(props.state.input?.filePath, props.message.path.cwd))
  return (
    <>
      <div data-component="tool-title"><span data-slot="name">Edit</span><span data-slot="target" title={props.state.input?.filePath}>{filePath()}</span></div>
      <div data-component="tool-result">
        <Show when={props.state.metadata?.error}><ContentError><pre><span data-color="red" data-marker="label">Error</span><span>{props.state.metadata?.message || ""}</span></pre></ContentError></Show>
        <Show when={props.state.metadata?.diff}><div data-component="diff"><ContentDiff diff={props.state.metadata?.diff} lang={getShikiLang(filePath() || "")} /></div></Show>
      </div>
    </>
  )
}
register("edit", EditTool)

export const GrepTool = (props: ToolProps) => (
  <>
    <div data-component="tool-title"><span data-slot="name">Grep</span><span data-slot="target">&ldquo;{props.state.input.pattern}&rdquo;</span></div>
    <div data-component="tool-result">
      <Show when={props.state.metadata?.matches && props.state.metadata?.matches > 0}><ContentText expand compact text={props.state.output} /></Show>
      <Show when={props.state.output && !props.state.metadata?.matches}><ContentText expand compact text={props.state.output} data-size="sm" data-color="dimmed" /></Show>
    </div>
  </>
)
register("grep", GrepTool)

export const GlobTool = (props: ToolProps) => (
  <>
    <div data-component="tool-title"><span data-slot="name">Glob</span><span data-slot="target">&ldquo;{props.state.input.pattern}&rdquo;</span></div>
    <Show when={props.state.metadata?.count && props.state.metadata?.count > 0}>
      <div data-component="tool-result"><ContentText expand compact text={props.state.output} /></div>
    </Show>
    <Show when={props.state.output && !props.state.metadata?.count}>
      <ContentText expand text={props.state.output} data-size="sm" data-color="dimmed" />
    </Show>
  </>
)
register("glob", GlobTool)

export const ListTool = (props: ToolProps) => {
  const path = createMemo(() => {
    const p = props.state.input?.path
    const cwd = props.message.path.cwd
    return p !== cwd ? stripWD(p, cwd) : p
  })
  return (
    <>
      <div data-component="tool-title"><span data-slot="name">LS</span><span data-slot="target" title={props.state.input?.path}>{path()}</span></div>
      <Show when={props.state.output}><div data-component="tool-result"><ContentText expand compact text={props.state.output} /></div></Show>
    </>
  )
}
register("list", ListTool)

export const BashTool = (props: ToolProps) => (
  <ContentBash expand command={props.state.input.command} output={props.state.metadata.output ?? props.state.metadata?.stdout} description={props.state.metadata.description} />
)
register("bash", BashTool)
