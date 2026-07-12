import { createSignal, createMemo, Show } from "solid-js"
import styles from "./input.module.css"

const MIN_HEIGHT = 44
const MAX_HEIGHT = 200

export interface SessionInputProps {
  disabled?: boolean
  placeholder?: string
  onSubmit?: (text: string) => void
}

export function SessionInput(props: SessionInputProps) {
  let textareaRef: HTMLTextAreaElement | undefined
  const [value, setValue] = createSignal("")
  const [focused, setFocused] = createSignal(false)

  const canSubmit = createMemo(() => value().trim().length > 0 && !props.disabled)

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = `${MIN_HEIGHT}px`
    const scroll = textareaRef.scrollHeight
    textareaRef.style.height = `${Math.min(Math.max(scroll, MIN_HEIGHT), MAX_HEIGHT)}px`
  }

  const handleSubmit = () => {
    const text = value().trim()
    if (!text || props.disabled) return
    props.onSubmit?.(text)
    setValue("")
    if (textareaRef) {
      textareaRef.style.height = `${MIN_HEIGHT}px`
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = () => {
    adjustHeight()
  }

  return (
    <div class={styles.root} data-focused={focused() ? true : undefined}>
      <div class={styles.inner}>
        <textarea
          ref={textareaRef}
          class={styles.textarea}
          value={value()}
          onInput={(e) => {
            setValue(e.currentTarget.value)
            handleInput()
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={props.placeholder || "Send a message..."}
          disabled={props.disabled}
          rows={1}
          aria-label="Message input"
        />
        <button
          type="button"
          class={styles.submit}
          disabled={!canSubmit()}
          onClick={handleSubmit}
          aria-label="Send message"
          title="Send (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
        </button>
      </div>
      <div class={styles.hint}>
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  )
}
