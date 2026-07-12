import type { MessageV2 } from "@mimo-ai/cli/session/message-v2"

export interface ToolProps {
  id: MessageV2.ToolPart["id"]
  tool: MessageV2.ToolPart["tool"]
  state: MessageV2.ToolStateCompleted
  message: MessageV2.Assistant
  isLastPart?: boolean
}

export type ToolComponent = (props: ToolProps) => import("solid-js").JSX.Element

const registry = new Map<string, ToolComponent>()

export function register(name: string, comp: ToolComponent) {
  registry.set(name, comp)
}

export function get(name: string): ToolComponent | undefined {
  return registry.get(name)
}
