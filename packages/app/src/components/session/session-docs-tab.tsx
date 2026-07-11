import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { Markdown } from "@mimo-ai/ui/markdown"
import { ScrollView } from "@mimo-ai/ui/scroll-view"
import { Icon } from "@mimo-ai/ui/icon"

type DocFile = {
  name: string
  fullPath: string
  mtime?: number
}

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
      .filter((e: any) => e.name?.endsWith(".md"))
      .map((e: any) => ({
        name: e.name,
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
      if (d.type === "project") {
        return listDir(config.client, config.directory, d.path)
      }
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
  // Sort: files with mtime by mtime (newest first), then by name reverse
  merged.sort((a, b) => {
    if (a.mtime !== undefined && b.mtime !== undefined) {
      if (a.mtime !== b.mtime) return b.mtime - a.mtime
    } else if (a.mtime !== undefined) return -1
    else if (b.mtime !== undefined) return 1
    return b.name.localeCompare(a.name)
  })
  return merged
}

type DocCategory = {
  labelKey: string
  dirs: DirConfig[]
}

export function SessionDocsTab() {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const dir = () => sdk.directory
  const baseUrl = () => document.baseURI.replace(/\/+$/, "")

  // Polling signal for real-time refresh
  const [tick, setTick] = createSignal(0)
  const pollInterval = 30_000 // 30 seconds

  onMount(() => {
    const interval = setInterval(() => setTick((t) => t + 1), pollInterval)
    onCleanup(() => clearInterval(interval))
  })

  const [selectedFile, setSelectedFile] = createSignal<string>("")
  const [fileContents, setFileContents] = createSignal<Record<string, string>>({})
  const [loadingFile, setLoadingFile] = createSignal<Record<string, boolean>>({})

  const globalDataDir = () => globalSync.data.path.data || ""
  const serverBase = baseUrl()

  // Build categories with both project-level and global-level dirs for plans
  const categories = (): DocCategory[] => [
    {
      labelKey: "session.docs.plans",
      dirs: [
        { type: "project", path: "docs/compose/plans" },
        { type: "project", path: ".mimocode/plans" },
        ...(globalDataDir() ? [{ type: "global" as const, path: `${globalDataDir()}/plans` }] : []),
      ],
    },
    { labelKey: "session.docs.specs", dirs: [{ type: "project", path: "docs/compose/specs" }] },
    { labelKey: "session.docs.reports", dirs: [{ type: "project", path: "docs/compose/reports" }] },
  ]

  const [planData] = createResource(
    () => [dir(), globalDataDir(), tick()] as const,
    ([d]) => fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: categories()[0].dirs }),
  )
  const [specData] = createResource(
    () => [dir(), tick()] as const,
    ([d]) => fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: categories()[1].dirs }),
  )
  const [reportData] = createResource(
    () => [dir(), tick()] as const,
    ([d]) => fetchFromDirs({ client: globalSDK.client, baseUrl: serverBase, directory: d, dirs: categories()[2].dirs }),
  )

  const handleSelect = async (fullPath: string) => {
    if (selectedFile() === fullPath) {
      setSelectedFile("")
      return
    }
    setSelectedFile(fullPath)
    if (fileContents()[fullPath]) return
    const d = dir()
    const gDataDir = globalDataDir()
    if (!d) return
    setLoadingFile((prev) => ({ ...prev, [fullPath]: true }))
    let text = ""
    // Determine if this is a global file (absolute path) or project file
    if (fullPath.startsWith("/")) {
      text = await readGlobalFileContent(serverBase, fullPath)
    } else {
      text = await readFileContent(globalSDK.client, d, fullPath)
    }
    setFileContents((prev) => ({ ...prev, [fullPath]: text }))
    setLoadingFile((prev) => ({ ...prev, [fullPath]: false }))
  }

  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <ScrollView class="flex-1">
        <div class="px-4 pt-4 pb-10 flex flex-col gap-5">
          <DocCategory
            label={t("session.docs.plans")}
            data={planData()}
            loading={planData.loading}
            selectedFile={selectedFile()}
            loadingFile={loadingFile()}
            fileContents={fileContents()}
            onSelect={handleSelect}
            emptyText={t("session.docs.empty")}
            loadingText={t("session.docs.loading")}
            loadingFileText={t("session.docs.loadingFile")}
          />
          <DocCategory
            label={t("session.docs.specs")}
            data={specData()}
            loading={specData.loading}
            selectedFile={selectedFile()}
            loadingFile={loadingFile()}
            fileContents={fileContents()}
            onSelect={handleSelect}
            emptyText={t("session.docs.empty")}
            loadingText={t("session.docs.loading")}
            loadingFileText={t("session.docs.loadingFile")}
          />
          <DocCategory
            label={t("session.docs.reports")}
            data={reportData()}
            loading={reportData.loading}
            selectedFile={selectedFile()}
            loadingFile={loadingFile()}
            fileContents={fileContents()}
            onSelect={handleSelect}
            emptyText={t("session.docs.empty")}
            loadingText={t("session.docs.loading")}
            loadingFileText={t("session.docs.loadingFile")}
          />
        </div>
      </ScrollView>
    </div>
  )
}

function DocCategory(props: {
  label: string
  data: GlobalFileEntry[] | undefined
  loading: boolean
  selectedFile: string
  loadingFile: Record<string, boolean>
  fileContents: Record<string, string>
  onSelect: (fullPath: string) => void
  emptyText: string
  loadingText: string
  loadingFileText: string
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="text-12-medium text-text-strong uppercase tracking-wider flex items-center gap-1.5">
        <Icon name="code" size="small" class="text-text-weak" />
        {props.label}
      </div>
      <Show
        when={!props.loading}
        fallback={<div class="text-12-regular text-text-weak pl-1">{props.loadingText}</div>}
      >
        <Show
          when={props.data && props.data.length > 0}
          fallback={<div class="text-12-regular text-text-weak pl-1">{props.emptyText}</div>}
        >
          <div class="flex flex-col gap-0.5">
            <For each={props.data}>
              {(file) => {
                const isSelected = () => props.selectedFile === file.fullPath
                const isLoading = () => props.loadingFile[file.fullPath] ?? false
                const isLoaded = () => !!props.fileContents[file.fullPath]

                return (
                  <div class="flex flex-col">
                    <button
                      type="button"
                      class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left cursor-pointer border-none w-full transition-colors text-12-regular"
                      classList={{
                        "bg-surface-base-hover": isSelected(),
                        "hover:bg-surface-base": !isSelected(),
                      }}
                      onClick={() => props.onSelect(file.fullPath)}
                    >
                      <Icon
                        name={isSelected() ? "chevron-down" : "arrow-right"}
                        size="small"
                        class="shrink-0"
                        classList={{
                          "text-text-interactive-base": isSelected(),
                          "text-text-weak": !isSelected(),
                        }}
                      />
                      <span
                        class="truncate flex-1"
                        classList={{
                          "text-text-strong": isSelected(),
                          "text-text-base": !isSelected(),
                        }}
                      >
                        {file.name}
                      </span>
                      <Show when={isLoading()}>
                        <span class="text-11-regular text-text-weak shrink-0">{props.loadingFileText}</span>
                      </Show>
                    </button>
                    <Show when={isSelected() && isLoaded()}>
                      <div class="mx-2 my-1 border border-border-weaker-base rounded-md p-3 bg-background-base overflow-auto max-h-[50vh]">
                        <Markdown text={props.fileContents[file.fullPath]} />
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
