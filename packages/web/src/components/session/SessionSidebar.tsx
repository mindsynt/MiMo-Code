import { Show } from "solid-js"
import styles from "./sidebar.module.css"

export function SessionSidebar(props: { title?: string; version?: string }) {
  return (
    <aside id="app-sidebar" class={styles.root}>
      <div class={styles.header}>
        <span class={styles.title}>{props.title || "Session"}</span>
        <Show when={props.version}>
          <span class={styles.version}>v{props.version}</span>
        </Show>
      </div>
      <div class={styles.body}>
        <p class={styles.placeholder}>Session context</p>
      </div>
      <div class={styles.footer}>
        <span class={styles.hint}>MiMoCode Web</span>
      </div>
    </aside>
  )
}
