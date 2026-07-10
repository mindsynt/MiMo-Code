import { For, createSignal, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { IconButton } from "@mimo-ai/ui/icon-button"
import { Button } from "@mimo-ai/ui/button"
import { useLanguage } from "@/context/language"

export const PluginPanel = () => {
  const sync = useGlobalSync()
  const language = useLanguage()
  const [installing, setInstalling] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const plugins = () => (sync.data.config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0]))

  const removePlugin = (index: number) => {
    const current = sync.data.config.plugin ?? []
    const updated = [...current.slice(0, index), ...current.slice(index + 1)]
    sync.updateConfig({ ...sync.data.config, plugin: updated }).catch(() => {})
  }

  const installPlugin = () => {
    const name = inputRef?.value?.trim()
    if (!name) return
    setInstalling(true)
    const current = sync.data.config.plugin ?? []
    sync
      .updateConfig({ ...sync.data.config, plugin: [...current, name] })
      .then(() => {
        if (inputRef) inputRef.value = ""
      })
      .catch(() => {})
      .finally(() => setInstalling(false))
  }

  return (
    <div class="flex flex-col gap-2 py-2">
      <div class="text-12-regular text-text-weak px-1">{plugins().length} plugin(s) installed</div>
      <For each={plugins()}>
        {(plugin, index) => (
          <div class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-base-hover group">
            <span class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
            <span class="flex-1 text-14-regular text-text-base truncate">{plugin}</span>
            <IconButton
              icon="close"
              variant="ghost"
              size="small"
              class="opacity-0 group-hover:opacity-100"
              onClick={() => removePlugin(index())}
            />
          </div>
        )}
      </For>
      <div class="flex items-center gap-2 mt-1">
        <input
          ref={inputRef}
          type="text"
          placeholder="plugin-name"
          class="flex-1 rounded-md border border-border-weak-base bg-surface-base px-2 py-1 text-14-regular text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"
        />
        <Button variant="primary" size="small" disabled={installing()} onClick={installPlugin}>
          {language.t("plugins.install")}
        </Button>
      </div>
    </div>
  )
}
