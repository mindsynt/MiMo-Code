import { Show, createMemo } from "solid-js"
import { ContentCode } from "../../share/content-code"
import { ContentText } from "../../share/content-text"
import { ContentError } from "../../share/content-error"
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

export const ReadTool = (props: ToolProps) => {
  const filePath = createMemo(() => stripWD(props.state.input?.filePath, props.message.path.cwd))
  const messages = undefined as any
  return (
    <>
      <div data-component="tool-title">
        <span data-slot="name">Read</span>
        <span data-slot="target" title={props.state.input?.filePath}>{filePath()}</span>
      </div>
      <div data-component="tool-result">
        <Show when={props.state.metadata?.error}>
          <ContentError><pre><span data-color="red" data-marker="label">Error</span><span>{props.state.output}</span></pre></ContentError>
        </Show>
        <Show when={typeof props.state.metadata?.preview === "string"}>
          <ContentCode lang={getShikiLang(filePath() || "")} code={props.state.metadata?.preview} />
        </Show>
        <Show when={typeof props.state.metadata?.preview !== "string" && props.state.output}>
          <ContentText expand compact text={props.state.output} />
        </Show>
      </div>
    </>
  )
}
register("read", ReadTool)

export const WriteTool = (props: ToolProps) => {
  const filePath = createMemo(() => stripWD(props.state.input?.filePath, props.message.path.cwd))
  return (
    <>
      <div data-component="tool-title">
        <span data-slot="name">Write</span>
        <span data-slot="target" title={props.state.input?.filePath}>{filePath()}</span>
      </div>
      <div data-component="tool-result">
        <Show when={props.state.metadata?.error}>
          <ContentError><pre><span data-color="red" data-marker="label">Error</span><span>{props.state.output}</span></pre></ContentError>
        </Show>
        <Show when={props.state.input?.content}>
          <ContentCode lang={getShikiLang(filePath() || "")} code={props.state.input?.content} />
        </Show>
      </div>
    </>
  )
}
register("write", WriteTool)
