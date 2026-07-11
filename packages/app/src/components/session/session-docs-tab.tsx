import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { Markdown } from "@mimo-ai/ui/markdown"
import { ScrollView } from "@mimo-ai/ui/scroll-view"
import { FileIcon } from "@mimo-ai/ui/file-icon"
import { getDirectory, getFilename } from "@mimo-ai/shared/util/path"

type GlobalFileEntry = {
  name: string
  fullPath: string
  mtime?: number
}

async function listDir(
  client: ReturnType<typeof useGlobalSDK>["client"],
  directory: string,
  dirPath: string,
): Promise<GlobalFileEntry[]> {
  try {
    const result = await client.file.list({ directory, path: dirPath })
    const entries = result.data ?? []
    return entries
      .filter((e: { name?: string }) => e.name?.endsWith(".md"))
      .map((e: { name?: string; mtime?: number }) => ({
        name: e.name!,
        fullPath: `${dirPath}/${e.name}`,
        mtime: e.mtime,
      }))
  } catch {
    return []
  }
}

async function listGlobalDir(baseUrl: string, absDirPath: string): Promise<GlobalFileEntry[]> {
  try {
    const url = `${baseUrl}/global/files?path=${encodeURIComponent(absDirPath)}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { name: string; absolute: string; mtime?: number }[]
    return data.map((e) => ({
      name: e.name,
      fullPath: e.absolute,
      mtime: e.mtime,
    }))
  } catch {
    return []
  }
}

async function readFileContent(
  client: ReturnType<typeof useGlobalSDK>["client"],
  directory: string,
  path: string,
): Promise<string> {
  const result = await client.file.read({ directory, path })
  const data = result.data as { content?: string } | undefined
  return data?.content ?? ""
}

async function readGlobalFileContent(baseUrl: string, filePath: string): Promise<string> {
  try {
    const url = `${baseUrl}/global/file/content?path=${encodeURIComponent(filePath)}`
    const res = await fetch(url)
    if (!res.ok) return ""
    const data = (await res.json()) as { content?: string }
    return data.content ?? ""
  } catch {
    return ""
  }
}

type DirConfig = {
  type: "project" | "global"
  path: string
}

async function fetchFromDirs(
  config: {
    client: ReturnType<typeof useGlobalSDK>["client"]
    baseUrl: string
    directory: string
    dirs: DirConfig[]
  },
): Promise<GlobalFileEntry[]> {
  const results = await Promise.all(
    config.dirs.map((d) => {
      if (d.type === "project") return listDir(config.client, config.directory, d.path)
      return listGlobalDir(config.baseUrl, d.path)
    }),
  )
  const seen = new Set<string>()
  const merged: GlobalFileEntry[] = []
  for (const list of results) {
    for (const file of list) {
      if (seen.has(file.name)) continue
      seen.add(file.name)
      merged.push(file)
    }
  }
  merged.sort((a, b) => {
    if (a.mtime !== undefined && b.mtime !== undefined) {
      if (a.mtime !== b.mtime) return b.mtime - a.mtime
    } else if (a.mtime !== undefined) return -1
    else if (b.mtime !== undefined) return 1
    return b.name.localeCompare(a.name)
  })
  return merged
}

type DocCategoryConfig = {
  labelKey: string
  dirs: DirConfig[]
}

export type { DocCategoryConfig }

function isRelevantFileChange(filePath: string, categoryDirs: DirConfig[][]): boolean {
  for (const dirs of categoryDirs) {
    for (const d of dirs) {
      if (d.type !== "project") continue
      if (filePath.startsWith(d.path + "/") || filePath.startsWith(d.path)) return true
    }
  }
  return false
}

function createDebounce(ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (fn: () => void) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; fn() }, ms)
  }
  debounced.clear = () => {
    if (timer) { clearTimeout(timer); timer = undefined }
  }
  return debounced
}

function totalCount(resources: { data: GlobalFileEntry[] | undefined }[]): number {
  const seen = new Set<string>()
  for (const r of resources) {
    if (!r.data) continue
    for (const f of r.data) seen.add(f.fullPath)
  }
  return seen.size
}

export function SessionDocsTab(props: { onCount?: (count: number) => void }) {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const dir = () => sdk.directory
  const baseUrl = () => document.baseURI.replace(/\/+$/, "")

  const [selectedFile, setSelectedFile] = createSignal<string>("")
  const [fileContents, setFileContents] = createSignal<Record<string, string>>({})
  const [loadingFile, setLoadingFile] = createSignal<Record<string, boolean>>({})
  const [planData, setPlanData] = createSignal<GlobalFileEntry[] | undefined>(undefined)
  const [specData, setSpecData] = createSignal<GlobalFileEntry[] | undefined>(undefined)
  const [reportData, setReportData] = createSignal<GlobalFileEntry[] | undefined>(undefined)
  const [dataLoading, setDataLoading] = createSignal(true)

  const globalDataDir = () => globalSync.data.path.data || ""
  const serverBase = baseUrl()

  const categories = (): DocCategoryConfig[] => [
    {
      labelKey: "session.docs.plans",
      dirs: [
        { type: "project", path: "docs/compose/plans" },
        { type: "project", path: "docs/plans" },
        { type: "project", path: "doc/plans" },
        { type: "project", path: ".mimocode/plans" },
        ...(globalDataDir() ? [{ type: "global" as const, path: `${globalDataDir()}/plans` }] : []),
      ],
    },
    {
      labelKey: "session.docs.specs",
      dirs: [
        { type: "project", path: "docs/compose/specs" },
        { type: "project", path: "docs/compose/designs" },
        { type: "project", path: "docs/specs" },
        { type: "project", path: "docs/designs" },
        { type: "project", path: "doc/specs" },
        { type: "project", path: "doc/designs" },
        ...(globalDataDir() ? [{ type: "global" as const, path: `${globalDataDir()}/specs` }] : []),
        ...(globalDataDir() ? [{ type: "global" as const, path: `${globalDataDir()}/designs` }] : []),
      ],
    },
    {
      labelKey: "session.docs.reports",
      dirs: [
        { type: "project", path: "docs/compose/reports" },
        { type: "project", path: "docs/reports" },
        { type: "project", path: "doc/reports" },
        ...(globalDataDir() ? [{ type: "global" as const, path: `${globalDataDir()}/reports` }] : []),
      ],
    },
  ]

  async function refreshAll() {
    const d = dir()
    if (!d) return
    const gDataDir = globalDataDir()
    const cats = categories()
    try {
/** 浅比较两个文件列表是否实质一致（名称 + mtime 不变视为相同） */
function filesEqual(a: GlobalFileEntry[] | undefined, b: GlobalFileEntry[] | undefined) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].mtime !== b[i].mtime) return false
  }
  return true
}

// ... （在 refreshAll 中使用）
      const [plans, specs, reports] = await Promise.all([
        fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: cats[0].dirs }),
        fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: cats[1].dirs }),
        fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: cats[2].dirs }),
      ])
      setPlanData((prev) => (filesEqual(prev, plans) ? prev : plans))
      setSpecData((prev) => (filesEqual(prev, specs) ? prev : specs))
      setReportData((prev) => (filesEqual(prev, reports) ? prev : reports))
    } catch (error) {
      console.error("[docs] refresh failed", error)
    } finally {
      setDataLoading(false)
    }
  }

  const debouncedRefresh = createDebounce(500)

  onMount(() => { refreshAll() })
  onCleanup(() => debouncedRefresh.clear())

  onMount(() => {
    const allCategoryDirs = categories().map((c) => c.dirs)
    const stop = sdk.event.listen((e: any) => {
      const ev = e.details ?? e?.payload ?? e
      if (ev?.type === "file.watcher.updated") {
        const props = ev.properties
        if (props?.file && typeof props.file === "string" && isRelevantFileChange(props.file, allCategoryDirs))
          debouncedRefresh(() => refreshAll())
      }
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const count = totalCount([{ data: planData() }, { data: specData() }, { data: reportData() }])
    props.onCount?.(count)
  })

  const handleSelect = async (fullPath: string) => {
    if (selectedFile() === fullPath) { setSelectedFile(""); return }
    setSelectedFile(fullPath)
    if (fileContents()[fullPath]) return
    const d = dir()
    if (!d) return
    setLoadingFile((prev) => ({ ...prev, [fullPath]: true }))
    const text = fullPath.startsWith("/")
      ? await readGlobalFileContent(serverBase, fullPath)
      : await readFileContent(globalSDK.client, d, fullPath)
    setFileContents((prev) => ({ ...prev, [fullPath]: text }))
    setLoadingFile((prev) => ({ ...prev, [fullPath]: false }))
  }

  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])

  return (
    <div class="h-full flex flex-col overflow-hidden" data-component="session-review">
      <ScrollView class="flex-1">
        <div class="px-3 pt-3 pb-12 flex flex-col gap-3">
          <Show when={!dataLoading()} fallback={
            <div class="text-12-regular text-text-weak px-3 py-3">{t("session.docs.loading")}</div>
          }>
            <div class="flex flex-col gap-3">
              <DocCategory
                label={t("session.docs.plans")}
                data={planData()}
                selectedFile={selectedFile()}
                loadingFile={loadingFile()}
                fileContents={fileContents()}
                onSelect={handleSelect}
                emptyText={t("session.docs.empty")}
                loadingFileText={t("session.docs.loadingFile")}
              />
              <DocCategory
                label={t("session.docs.specs")}
                data={specData()}
                selectedFile={selectedFile()}
                loadingFile={loadingFile()}
                fileContents={fileContents()}
                onSelect={handleSelect}
                emptyText={t("session.docs.empty")}
                loadingFileText={t("session.docs.loadingFile")}
              />
              <DocCategory
                label={t("session.docs.reports")}
                data={reportData()}
                selectedFile={selectedFile()}
                loadingFile={loadingFile()}
                fileContents={fileContents()}
                onSelect={handleSelect}
                emptyText={t("session.docs.empty")}
                loadingFileText={t("session.docs.loadingFile")}
              />
            </div>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}

function DocCategory(props: {
  label: string
  data: GlobalFileEntry[] | undefined
  selectedFile: string
  loadingFile: Record<string, boolean>
  fileContents: Record<string, string>
  onSelect: (fullPath: string) => void
  emptyText: string
  loadingFileText: string
}) {
  return (
    <div class="flex flex-col rounded-lg border border-border-base overflow-hidden bg-background-base">
      <div class="h-8 flex items-center gap-x-1.5 px-3 border-b border-border-base bg-surface-raised-base">
        <span class="text-12-medium text-text-strong uppercase tracking-wider">{props.label}</span>
      </div>
      <Show
        when={props.data && props.data.length > 0}
        fallback={<div class="text-13-regular text-text-base px-3 py-3">{props.emptyText}</div>}
      >
        <div data-component="filetree" class="flex flex-col divide-y divide-border-weaker-base">
          <For each={props.data}>
            {(file) => {
              const isSelected = () => props.selectedFile === file.fullPath
              const isLoading = () => props.loadingFile[file.fullPath] ?? false
              const isLoaded = () => !!props.fileContents[file.fullPath]

              return (
                <div class="flex flex-col">
                  <button
                    type="button"
                    class="group w-full min-w-0 h-8 flex items-center justify-start gap-x-2 px-3 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer border-none bg-background-base"
                    classList={{
                      "bg-surface-raised-base-hover": isSelected(),
                    }}
                    onClick={() => props.onSelect(file.fullPath)}
                  >
                    <span class="filetree-iconpair size-4 shrink-0">
                      <FileIcon
                        node={{ path: file.fullPath, type: "file" }}
                        class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover:opacity-100 transition-opacity"
                        classList={{ "opacity-100": isSelected() }}
                      />
                      <FileIcon
                        node={{ path: file.fullPath, type: "file" }}
                        class="size-4 filetree-icon filetree-icon--mono group-hover:opacity-0 transition-opacity"
                        mono
                        classList={{ "opacity-0": isSelected() }}
                      />
                    </span>
                    <span class="flex-1 min-w-0 text-13-medium whitespace-nowrap truncate text-text-strong">
                      {file.name.replace(/\.md$/i, "")}
                    </span>
                    <Show when={file.fullPath.includes("/")}>
                      <span class="shrink-0 min-w-0 text-12-regular text-text-base truncate max-w-24">
                        {getDirectory(file.fullPath)}
                      </span>
                    </Show>
                    <Show when={isLoading()}>
                      <span class="text-12-regular text-text-weak shrink-0">{props.loadingFileText}</span>
                    </Show>
                  </button>
                  <Show when={isSelected() && isLoaded()}>
                    <div class="border-t border-border-weaker-base px-4 py-3 bg-background-base">
                      <Markdown text={props.fileContents[file.fullPath]} />
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
