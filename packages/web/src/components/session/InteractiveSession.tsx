import { createSignal, Show } from "solid-js"
import { SessionView } from "./Session"
import { SessionInput } from "./SessionInput"
import type { Session } from "@mimo-ai/cli/session/index"

interface InteractiveSessionProps {
  id: string
  api: string
  info: Session.Info
  messages: Record<string, string>
}

export function InteractiveSession(props: InteractiveSessionProps) {
  const [sending, setSending] = createSignal(false)

  const handleSubmit = async (text: string) => {
    setSending(true)
    try {
      // Use the WebSocket-based real-time view for now
      // Message sending via API is handled separately
      console.log("Submit:", text, "session:", props.id)
      // TODO: implement actual send via API
    } catch (err) {
      console.error("Failed to send:", err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ flex: 1, "overflow-y": "auto" }}>
        <SessionView id={props.id} api={props.api} info={props.info} messages={props.messages} />
      </div>
      <SessionInput
        disabled={sending()}
        onSubmit={handleSubmit}
        placeholder="Send a message..."
      />
    </div>
  )
}
