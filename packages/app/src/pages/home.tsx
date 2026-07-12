import { createMemo, For, Show, Switch, Match } from "solid-js"
import { Button } from "@mimo-ai/ui/button"
import { Logo } from "@mimo-ai/ui/logo"
import { Icon } from "@mimo-ai/ui/icon"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@mimo-ai/shared/util/encode"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@mimo-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import type { Project } from "@mimo-ai/sdk/v2/client"
import { DateTime } from "luxon"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() =>
    sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 8),
  )

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    if (!sync.data.project.find((p) => p.worktree === directory)) {
      sync.set("project", (prev: Project[]) => [
        { id: directory, worktree: directory, time: { created: Date.now(), updated: Date.now() }, sandboxes: [] },
        ...prev,
      ])
    }
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) for (const directory of result) openProject(directory)
      else if (result) openProject(result)
    }
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({ title: language.t("command.project.open"), multiple: true })
      resolve(result)
    } else {
      dialog.show(() => <DialogSelectDirectory multiple={true} onSelect={resolve} />, () => resolve(null))
    }
  }

  return (
    <div class="flex flex-col items-center justify-center w-full h-full overflow-y-auto">
      {/* Hero 区域 - 居中垂直对齐 */}
      <div class="flex flex-col items-center justify-center min-h-[60vh] px-6 py-16">
        {/* Logo - 大尺寸，透明 */}
        <Logo class="w-48 md:w-60 opacity-[0.08] mb-8" />

        {/* 服务器/提供商标识 */}
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border-weak-base hover:border-border-hover transition-colors text-14-regular text-text-weak mb-10"
          onClick={() => dialog.show(() => <DialogSelectServer />)}
        >
          <div class={`size-2 rounded-full ${serverDotClass()}`} />
          {server.name}
        </button>

        {/* 快速操作卡片 */}
        <div class="flex gap-3 mb-12">
          <button
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-weak-base hover:border-border-interactive-base hover:text-text-interactive-base transition-all bg-surface-raised-base text-14-regular text-text-base"
            onClick={chooseProject}
          >
            <Icon name="folder-add-left" size="medium" />
            {language.t("command.project.open")}
          </button>
        </div>
      </div>

      {/* 最近项目列表 - Codex 风格卡片 */}
      <Show when={sync.ready && recent().length > 0}>
        <div class="w-full max-w-2xl px-6 pb-16">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</h2>
            <Show when={sync.data.project.length > 8}>
              <span class="text-12-regular text-text-weaker">
                {sync.data.project.length} projects
              </span>
            </Show>
          </div>
          <div class="flex flex-col gap-1">
            <For each={recent()}>
              {(project) => (
                <button
                  class="flex items-center justify-between w-full px-4 py-2.5 rounded-lg hover:bg-surface-base-hover transition-colors text-left group"
                  onClick={() => openProject(project.worktree)}
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <Icon name="folder-add-left" size="small" class="text-icon-weak-base shrink-0" />
                    <span class="text-14-mono text-text-base truncate">
                      {project.worktree.replace(homedir(), "~")}
                    </span>
                  </div>
                  <span class="text-12-regular text-text-weaker shrink-0 ml-3">
                    {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* 加载状态 */}
      <Show when={!sync.ready}>
        <div class="flex flex-col items-center gap-3 py-20">
          <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
        </div>
      </Show>

      {/* 空状态 - 首次使用 */}
      <Show when={sync.ready && recent().length === 0}>
        <div class="flex flex-col items-center gap-4 py-12">
          <Icon name="folder-add-left" size="large" class="text-icon-weak-base" />
          <div class="flex flex-col gap-1 items-center">
            <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
          </div>
          <Button class="px-3 mt-2" onClick={chooseProject}>
            {language.t("command.project.open")}
          </Button>
        </div>
      </Show>
    </div>
  )
}
