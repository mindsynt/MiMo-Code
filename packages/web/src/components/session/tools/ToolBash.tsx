import { Show } from "solid-js"
import { ContentBash } from "../../share/content-bash"
import { register } from "./ToolDispatch"
import type { ToolProps } from "./ToolDispatch"

export const BashTool = (props: ToolProps) => (
  <ContentBash
    expand
    command={props.state.input.command}
    output={props.state.metadata.output ?? props.state.metadata?.stdout}
    description={props.state.metadata.description}
  />
)
register("bash", BashTool)
