# Web 功能补齐：功能中心框架 + 语音输入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 前端中搭建「功能中心」侧边栏框架，首批实现语音输入功能

**Architecture:** 在侧边栏轨道新增「功能中心」入口按钮，点击后展开独立面板。语音输入使用 Web Speech API，在 Prompt 输入区添加麦克风按钮，在功能中心面板添加配置卡。

**Tech Stack:** SolidJS, Web Speech API (SpeechRecognition), Tailwind CSS v4, @mimo-ai/ui 组件库

## Global Constraints

- 遵循项目编码规范（见 AGENTS.md）：无 try/catch（除非不可避免）、无 any 类型、优先 Bun API、函数式数组方法
- 所有 UI 字符串需添加中英文 i18n 条目
- 新组件遵循 SolidJS 响应式模式，使用 `createSignal`/`createEffect`/`createMemo`
- 使用已有的 `IconButton`、`Tooltip`、`Collapsible` 等 UI 组件
- 不引入新的外部依赖（语音用浏览器原生 API）

---

### Task 1: 通用功能卡片组件 + FeatureCenterProvider

**Covers:** [S3.4, S3.5]

**Files:**

- Create: `src/components/feature-center/feature-card.tsx`
- Create: `src/context/feature-center.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Modify: remaining i18n language files (add placeholder entries)

**Interfaces:**

- Consumes: `@mimo-ai/ui/collapsible` (Collapsible), `@mimo-ai/ui/icon-button` (IconButton)
- Produces: `<FeatureCard>` component, `<FeatureCenterProvider>` and `useFeatureCenter` hook

- [ ] **Step 1: Create `feature-card.tsx`**

```tsx
import { createSignal, type JSX } from "solid-js"
import { Collapsible } from "@mimo-ai/ui/collapsible"

interface FeatureCardProps {
  icon: string
  title: string
  description: string
  children: JSX.Element
  defaultOpen?: boolean
}

export const FeatureCard = (props: FeatureCardProps): JSX.Element => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  return (
    <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
      <Collapsible.Trigger class="flex items-center gap-2 w-full px-3 py-2 text-14-medium text-text-strong hover:bg-surface-base-hover rounded-md">
        <span>{props.icon}</span>
        <span class="flex-1 text-left">{props.title}</span>
        <span class="text-12-regular text-text-weak truncate max-w-[120px]">{props.description}</span>
      </Collapsible.Trigger>
      <Collapsible.Content class="px-3 py-2">{props.children}</Collapsible.Content>
    </Collapsible>
  )
}
```

- [ ] **Step 2: Create `feature-center.tsx`**

```tsx
import { createSignal, createContext, useContext, type JSX, type Accessor } from "solid-js"

type FeatureCenterTab = "projects" | "features"

interface FeatureCenterContextValue {
  activeTab: Accessor<FeatureCenterTab>
  setActiveTab: (tab: FeatureCenterTab) => void
}

const FeatureCenterContext = createContext<FeatureCenterContextValue>()

export const FeatureCenterProvider = (props: { children: JSX.Element }): JSX.Element => {
  const [activeTab, setActiveTab] = createSignal<FeatureCenterTab>("projects")
  return (
    <FeatureCenterContext.Provider value={{ activeTab, setActiveTab }}>{props.children}</FeatureCenterContext.Provider>
  )
}

export const useFeatureCenter = (): FeatureCenterContextValue => {
  const ctx = useContext(FeatureCenterContext)
  if (!ctx) throw new Error("useFeatureCenter must be used within FeatureCenterProvider")
  return ctx
}
```

- [ ] **Step 3: Add i18n strings for feature center**

In `src/i18n/en.ts`, add:

```ts
"featureCenter.title": "Feature Center",
"featureCenter.voice": "Voice Input",
"featureCenter.voice.description": "Speech-to-text input via microphone",
```

In `src/i18n/zh.ts`, add:

```ts
"featureCenter.title": "功能中心",
"featureCenter.voice": "语音输入",
"featureCenter.voice.description": "通过麦克风进行语音转文字输入",
```

Add placeholder entries to all other language files with the English strings.

- [ ] **Step 4: Commit**

```bash
git add src/components/feature-center/ src/context/feature-center.tsx src/i18n/
git commit -m "feat(web): add FeatureCard component and FeatureCenterProvider"
```

---

### Task 2: 功能中心面板 + 侧边栏入口按钮

**Covers:** [S3.1, S3.2, S3.3]

**Files:**

- Create: `src/pages/layout/feature-center.tsx`
- Create: `src/pages/layout/feature-center-button.tsx`
- Modify: `src/pages/layout/sidebar-shell.tsx` (lines 92-111, add button between settings and help)
- Modify: `src/pages/layout.tsx` (around line 2355, add feature center panel switching)

**Interfaces:**

- Consumes: `useFeatureCenter()` hook, `FeatureCard` component
- Produces: `<FeatureCenterPanel>` panel, `<FeatureCenterButton>` button

- [ ] **Step 1: Create `feature-center.tsx`**

```tsx
import { type JSX } from "solid-js"
import { useFeatureCenter } from "@/context/feature-center"
import { useLanguage } from "@mimo-ai/ui/language"
import { FeatureCard } from "@/components/feature-center/feature-card"

export const FeatureCenterPanel = (): JSX.Element => {
  const { activeTab } = useFeatureCenter()
  const language = useLanguage()

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="px-4 py-3 text-14-medium text-text-strong border-b border-border-weak-base">
        {language.t("featureCenter.title")}
      </div>
      <div class="flex-1 py-2 space-y-1">
        {/* Voice input card - placeholder, will be filled in Task 4 */}
        <FeatureCard
          icon="🎤"
          title={language.t("featureCenter.voice")}
          description={language.t("featureCenter.voice.description")}
        >
          <div class="text-14-regular text-text-weak py-2">Voice input configuration coming soon...</div>
        </FeatureCard>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `feature-center-button.tsx`**

```tsx
import { type JSX } from "solid-js"
import { IconButton } from "@mimo-ai/ui/icon-button"
import { Tooltip } from "@mimo-ai/ui/tooltip"

interface FeatureCenterButtonProps {
  active: boolean
  onClick: () => void
  label: string
  placement?: "right" | "bottom"
}

export const FeatureCenterButton = (props: FeatureCenterButtonProps): JSX.Element => {
  return (
    <Tooltip placement={props.placement ?? "right"} value={props.label}>
      <IconButton
        icon="bolt"
        variant={props.active ? "primary" : "ghost"}
        size="large"
        onClick={props.onClick}
        aria-label={props.label}
      />
    </Tooltip>
  )
}
```

- [ ] **Step 3: Modify `sidebar-shell.tsx`**

Add the feature center button between settings gear and help button (lines 101-110):

```tsx
{
  /* In props, add: featureCenterLabel, featureCenterActive, onToggleFeatureCenter */
}
;<Tooltip placement={placement()} value={props.featureCenterLabel()}>
  <IconButton
    icon="bolt"
    variant={props.featureCenterActive() ? "primary" : "ghost"}
    size="large"
    onClick={props.onToggleFeatureCenter}
    aria-label={props.featureCenterLabel()}
  />
</Tooltip>
```

Add to the interface:

```ts
featureCenterLabel: Accessor<string>
featureCenterActive: Accessor<boolean>
onToggleFeatureCenter: () => void
```

- [ ] **Step 4: Modify `layout.tsx`**

Wrap the sidebar section with `FeatureCenterProvider`:

```tsx
import { FeatureCenterProvider, useFeatureCenter } from "@/context/feature-center"
import { FeatureCenterPanel } from "./layout/feature-center"
import { FeatureCenterButton } from "./layout/feature-center-button"

// Inside the component that uses SidebarContent, add state:
const [showFeatures, setShowFeatures] = createSignal(false)

// Modify renderPanel to switch between projects and features:
renderPanel={() =>
  showFeatures()
    ? <FeatureCenterPanel />
    : mobile
      ? <SidebarPanel project={currentProject} mobile />
      : <SidebarPanel project={currentProject} merged />
}

// Add featureCenter props to SidebarContent:
featureCenterLabel={() => language.t("featureCenter.title")}
featureCenterActive={() => showFeatures()}
onToggleFeatureCenter={() => setShowFeatures(v => !v)}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/layout/feature-center.tsx src/pages/layout/feature-center-button.tsx src/pages/layout/sidebar-shell.tsx src/pages/layout.tsx
git commit -m "feat(web): add feature center sidebar panel with project/feature tab switching"
```

---

### Task 3: Web Speech API 工具函数

**Covers:** [S4.1, S4.6]

**Files:**

- Create: `src/utils/voice.ts`

**Interfaces:**

- Consumes: browser Web Speech API (`SpeechRecognition`)
- Produces: `createSpeechRecognizer()` factory, `enumerateDevices()` utility

- [ ] **Step 1: Create `voice.ts`**

```ts
export interface SpeechRecognizerOptions {
  language?: string
  continuous?: boolean
  interimResults?: boolean
  onResult?: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onEnd?: () => void
}

export interface SpeechRecognizerHandle {
  start: () => void
  stop: () => void
  abort: () => void
  isRunning: boolean
}

export function isSpeechSupported(): boolean {
  return !!(
    (window as Record<string, unknown>).SpeechRecognition || (window as Record<string, unknown>).webkitSpeechRecognition
  )
}

function getSpeechRecognition(): typeof SpeechRecognition | null {
  const w = window as Record<string, unknown>
  return ((w.SpeechRecognition || w.webkitSpeechRecognition) as typeof SpeechRecognition) ?? null
}

export function enumerateAudioDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([])
  return navigator.mediaDevices.enumerateDevices().then((devices) => devices.filter((d) => d.kind === "audioinput"))
}

export function createSpeechRecognizer(options: SpeechRecognizerOptions): SpeechRecognizerHandle {
  const SpeechRecognition = getSpeechRecognition()
  if (!SpeechRecognition) {
    return { start: () => {}, stop: () => {}, abort: () => {}, isRunning: false }
  }

  let recognition: InstanceType<typeof SpeechRecognition> | null = null
  let running = false

  const start = () => {
    if (running) return
    recognition = new SpeechRecognition()
    recognition.lang = options.language ?? "en-US"
    recognition.continuous = options.continuous ?? true
    recognition.interimResults = options.interimResults ?? true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ""
      let final = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) final += transcript
        else interim += transcript
      }
      if (final) options.onResult?.(final, true)
      if (interim) options.onResult?.(interim, false)
    }

    recognition.onerror = (event: Event) => {
      const err = event as SpeechRecognitionErrorEvent
      options.onError?.(err.error ?? "unknown")
    }

    recognition.onend = () => {
      running = false
      options.onEnd?.()
    }

    recognition.start()
    running = true
  }

  const stop = () => {
    recognition?.stop()
    running = false
  }

  const abort = () => {
    recognition?.abort()
    running = false
  }

  return {
    start,
    stop,
    abort,
    get isRunning() {
      return running
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/voice.ts
git commit -m "feat(web): add Web Speech API utility for voice recognition"
```

---

### Task 4: VoiceProvider 语音状态管理

**Covers:** [S4.3, S4.4, S4.6]

**Files:**

- Create: `src/context/voice.tsx`
- Modify: `src/utils/voice.ts` (export additional types if needed)

**Interfaces:**

- Consumes: `createSpeechRecognizer` from utils/voice, `enumerateAudioDevices`
- Produces: `VoiceProvider`, `useVoice()` hook returning `VoiceState` + actions

- [ ] **Step 1: Create `voice.tsx`**

```tsx
import { createSignal, createEffect, onCleanup, createContext, useContext, type JSX, type Accessor } from "solid-js"
import {
  createSpeechRecognizer,
  enumerateAudioDevices,
  isSpeechSupported,
  type SpeechRecognizerHandle,
} from "@/utils/voice"
import { useLanguage } from "@mimo-ai/ui/language"

export interface VoiceState {
  isSupported: boolean
  isListening: Accessor<boolean>
  transcript: Accessor<string>
  interimTranscript: Accessor<string>
  error: Accessor<string | null>
  deviceId: Accessor<string>
  voiceControl: Accessor<boolean>
  voiceSend: Accessor<boolean>
  devices: Accessor<MediaDeviceInfo[]>
}

interface VoiceActions {
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
  setDeviceId: (id: string) => void
  setVoiceControl: (on: boolean) => void
  setVoiceSend: (on: boolean) => void
  refreshDevices: () => void
}

type VoiceContextValue = VoiceState & VoiceActions

const VoiceContext = createContext<VoiceContextValue>()

export const VoiceProvider = (props: { children: JSX.Element }): JSX.Element => {
  const language = useLanguage()
  const supported = isSpeechSupported()
  const [isListening, setListening] = createSignal(false)
  const [transcript, setTranscript] = createSignal("")
  const [interimTranscript, setInterim] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [deviceId, setDeviceId] = createSignal("")
  const [voiceControl, setVoiceControl] = createSignal(false)
  const [voiceSend, setVoiceSend] = createSignal(false)
  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([])

  let recognizer: SpeechRecognizerHandle | null = null

  const refreshDevices = () => {
    enumerateAudioDevices().then(setDevices)
  }

  createEffect(() => {
    refreshDevices()
  })

  const getLang = () => {
    const locale = language.locale?.() ?? "en"
    if (locale === "zh" || locale === "zht") return "cmn-Hans-CN"
    if (locale === "ja") return "ja-JP"
    return "en-US"
  }

  const startListening = () => {
    setError(null)
    if (!supported) return

    recognizer = createSpeechRecognizer({
      language: getLang(),
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal) => {
        if (isFinal) {
          setTranscript((prev) => prev + text)
          setInterim("")
        } else {
          setInterim(text)
        }
      },
      onError: (err) => {
        setError(err)
        setListening(false)
      },
      onEnd: () => {
        setListening(false)
      },
    })

    // Request mic permission first
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then(() => {
        recognizer?.start()
        setListening(true)
      })
      .catch((err) => {
        setError(`Microphone access denied: ${err.message}`)
      })
  }

  const stopListening = () => {
    recognizer?.stop()
    recognizer = null
    setListening(false)
  }

  const toggleListening = () => {
    if (isListening()) stopListening()
    else startListening()
  }

  onCleanup(() => {
    recognizer?.abort()
  })

  const value: VoiceContextValue = {
    isSupported: supported,
    isListening,
    transcript,
    interimTranscript,
    error,
    deviceId,
    voiceControl,
    voiceSend,
    devices,
    startListening,
    stopListening,
    toggleListening,
    setDeviceId,
    setVoiceControl,
    setVoiceSend,
    refreshDevices,
  }

  return <VoiceContext.Provider value={value}>{props.children}</VoiceContext.Provider>
}

export const useVoice = (): VoiceContextValue => {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider")
  return ctx
}
```

- [ ] **Step 2: Integrate VoiceProvider into the app**

In `app.tsx`, add `VoiceProvider` inside the provider tree near `ModelsProvider`:

```tsx
import { VoiceProvider } from "@/context/voice"

// Wrap around or near SettingsProvider and PermissionProvider
<VoiceProvider>
  {...existing providers}
</VoiceProvider>
```

- [ ] **Step 3: Commit**

```bash
git add src/context/voice.tsx
git commit -m "feat(web): add VoiceProvider with Web Speech API integration"
```

---

### Task 5: 麦克风按钮（Prompt 输入区）

**Covers:** [S4.2, S4.4]

**Files:**

- Create: `src/components/voice/voice-button.tsx`
- Modify: `src/components/prompt-input.tsx` (around line 1408-1434, add mic button before submit button)
- Modify: `src/i18n/en.ts` and `src/i18n/zh.ts`

**Interfaces:**

- Consumes: `useVoice()` hook
- Produces: `<VoiceButton>` component

- [ ] **Step 1: Create `voice-button.tsx`**

```tsx
import { type JSX } from "solid-js"
import { IconButton } from "@mimo-ai/ui/icon-button"
import { Tooltip } from "@mimo-ai/ui/tooltip"
import { useVoice } from "@/context/voice"

interface VoiceButtonProps {
  onTranscript: (text: string) => void
  t: (key: string) => string
}

export const VoiceButton = (props: VoiceButtonProps): JSX.Element | null => {
  const voice = useVoice()

  if (!voice.isSupported) return null

  const handleClick = () => {
    if (voice.isListening()) {
      voice.stopListening()
      // Append final transcript to prompt
      const finalText = voice.transcript()
      if (finalText) props.onTranscript(finalText)
    } else {
      voice.startListening()
    }
  }

  return (
    <Tooltip placement="top" value={voice.isListening() ? props.t("voice.stop") : props.t("voice.start")}>
      <IconButton
        icon={voice.isListening() ? "mic-recording" : "mic"}
        variant={voice.isListening() ? "danger" : "ghost"}
        size="small"
        onClick={handleClick}
        aria-label={voice.isListening() ? props.t("voice.stop") : props.t("voice.start")}
        class={voice.isListening() ? "animate-pulse" : ""}
      />
    </Tooltip>
  )
}
```

- [ ] **Step 2: Add i18n strings**

In `en.ts`:

```ts
"voice.start": "Start voice input",
"voice.stop": "Stop voice input",
```

In `zh.ts`:

```ts
"voice.start": "开始语音输入",
"voice.stop": "停止语音输入",
```

- [ ] **Step 3: Modify `prompt-input.tsx`**

Around line 1422 (the action buttons container), add the voice button before the submit button:

```tsx
<Show when={voice.isSupported}>
  <VoiceButton
    onTranscript={(text) => {
      // Insert text at cursor position in the editor
      insertTextAtCursor(text)
    }}
    t={(key) => language.t(key as Parameters<typeof language.t>[0])}
  />
</Show>
```

And import:

```tsx
import { VoiceButton } from "@/components/voice/voice-button"
import { useVoice } from "@/context/voice"
```

Add `useVoice()` call in the `PromptInput` component.

- [ ] **Step 4: Commit**

```bash
git add src/components/voice/ src/i18n/ src/components/prompt-input.tsx
git commit -m "feat(web): add voice input microphone button to prompt area"
```

---

### Task 6: 语音配置卡（功能中心面板）

**Covers:** [S4.2 (配置部分), S4.5]

**Files:**

- Create: `src/pages/feature-center/voice-panel.tsx`
- Modify: `src/pages/layout/feature-center.tsx` (replace placeholder card with real VoicePanel)
- Modify: `src/i18n/en.ts` and `src/i18n/zh.ts`

**Interfaces:**

- Consumes: `useVoice()` hook, `FeatureCard` component
- Produces: `<VoicePanel>` component

- [ ] **Step 1: Create `voice-panel.tsx`**

```tsx
import { type JSX, For } from "solid-js"
import { useVoice } from "@/context/voice"
import { useLanguage } from "@mimo-ai/ui/language"
import { Button } from "@mimo-ai/ui/button"
import { Switch } from "@mimo-ai/ui/switch"
import { Select } from "@mimo-ai/ui/select"

export const VoicePanel = (): JSX.Element => {
  const voice = useVoice()
  const language = useLanguage()
  const t = (key: string) => language.t(key as Parameters<typeof language.t>[0])

  return (
    <div class="flex flex-col gap-3 py-2">
      {/* Status indicator */}
      <div class="flex items-center gap-2 text-14-regular">
        <span class="text-text-weak">{t("voice.status")}:</span>
        <span
          classList={{
            "text-icon-success-base": voice.isSupported && !voice.isListening(),
            "text-icon-critical-base animate-pulse": voice.isListening(),
            "text-text-weak": !voice.isSupported,
          }}
        >
          {voice.isListening() ? t("voice.listening") : voice.isSupported ? t("voice.ready") : t("voice.notSupported")}
        </span>
      </div>

      {/* Error display */}
      {voice.error() && (
        <div class="text-12-regular text-icon-critical-base bg-surface-critical-base rounded-md px-2 py-1">
          {voice.error()}
        </div>
      )}

      {/* Device selection */}
      <div class="flex flex-col gap-1">
        <label class="text-12-regular text-text-weak">{t("voice.device")}</label>
        <select
          class="w-full rounded-md border border-border-weak-base bg-surface-base px-2 py-1 text-14-regular"
          value={voice.deviceId()}
          onChange={(e) => voice.setDeviceId(e.currentTarget.value)}
        >
          <For each={voice.devices()}>
            {(device) => (
              <option value={device.deviceId}>{device.label || `Microphone ${device.deviceId.slice(0, 8)}`}</option>
            )}
          </For>
        </select>
      </div>

      {/* Voice control mode */}
      <div class="flex items-center justify-between">
        <span class="text-14-regular">{t("voice.control")}</span>
        <Switch checked={voice.voiceControl()} onChange={voice.setVoiceControl} />
      </div>

      {/* Voice send */}
      <div class="flex items-center justify-between">
        <span class="text-14-regular">{t("voice.send")}</span>
        <Switch checked={voice.voiceSend()} onChange={voice.setVoiceSend} />
      </div>

      {/* Test button */}
      <Button variant="secondary" size="small" onClick={voice.toggleListening}>
        {voice.isListening() ? t("voice.stop") : t("voice.test")}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Add i18n strings**

In `en.ts`:

```ts
"voice.status": "Status",
"voice.ready": "Ready",
"voice.listening": "Listening",
"voice.notSupported": "Not supported",
"voice.device": "Input device",
"voice.control": "Voice control mode",
"voice.send": "Voice send",
"voice.test": "Test microphone",
```

In `zh.ts`:

```ts
"voice.status": "状态",
"voice.ready": "就绪",
"voice.listening": "录音中",
"voice.notSupported": "不支持",
"voice.device": "输入设备",
"voice.control": "语音控制模式",
"voice.send": "语音发送",
"voice.test": "测试麦克风",
```

- [ ] **Step 3: Update `feature-center.tsx` to use VoicePanel**

Replace the placeholder children in the voice FeatureCard:

```tsx
<FeatureCard
  icon="🎤"
  title={language.t("featureCenter.voice")}
  description={language.t("featureCenter.voice.description")}
>
  <VoicePanel />
</FeatureCard>
```

And add import:

```tsx
import { VoicePanel } from "@/pages/feature-center/voice-panel"
```

- [ ] **Step 4: WRITE `insertTextAtCursor` helper if not already available**

If `prompt-input.tsx` doesn't already have an `insertTextAtCursor` function, add it:

```ts
const insertTextAtCursor = (text: string) => {
  if (!editorRef) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) {
    // Append at end
    editorRef.textContent += text
    return
  }
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
  // Trigger input event
  editorRef.dispatchEvent(new InputEvent("input", { bubbles: true }))
}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/feature-center/voice-panel.tsx src/pages/layout/feature-center.tsx src/i18n/
git commit -m "feat(web): add voice input configuration panel in feature center"
```

---

### Task 7: 语音控制命令支持

**Covers:** [S4.5]

**Files:**

- Modify: `src/context/voice.tsx` (add command matching logic)
- Modify: `src/utils/voice.ts` (add voice command definitions if needed)

- [ ] **Step 1: Add voice command handling to VoiceProvider**

In `voice.tsx`, add a `processVoiceCommand` function:

```tsx
interface VoiceCommand {
  pattern: RegExp
  action: () => void
  label: string
}

const createDefaultCommands = (t: (key: string) => string): VoiceCommand[] => [
  { pattern: /^(send|submit|go|发送|提交)$/i, action: () => {}, label: "send" },
  { pattern: /^(clear|erase|清空|清除)$/i, action: () => {}, label: "clear" },
  { pattern: /^(new|new session|新建|新会话)$/i, action: () => {}, label: "new" },
  { pattern: /^(undo|撤销)$/i, action: () => {}, label: "undo" },
  { pattern: /^(redo|重做)$/i, action: () => {}, label: "redo" },
]

// In VoiceProvider, add:
// const commands = createDefaultCommands(language.t)
// When a final result comes in:
//   1. Check if voiceControl() is on
//   2. If yes, match against commands
//   3. If matched, execute command action
//   4. If not matched, treat as normal text
```

- [ ] **Step 2: Wire commands through VoiceProvider callbacks**

Add `onCommand` and `onSend` callbacks to `VoiceContextValue`:

```tsx
onCommand?: (command: string) => void
```

In `prompt-input.tsx`, pass handlers that submit/clear/undo/redo.

- [ ] **Step 3: Commit**

```bash
git add src/context/voice.tsx src/utils/voice.ts
git commit -m "feat(web): add voice command matching for send/clear/undo/redo"
```

---

### 执行方式

建议使用 `compose:subagent` 模式：每个 Task 由一个子代理独立完成，按 Task 1→7 顺序执行。每个 Task 完成后自动运行验证（如果有可运行的测试）。

### 验证方式

1. 功能中心按钮出现在侧边栏轨道底部（设置和帮助之间）
2. 点击按钮展开功能中心面板，显示语音输入卡片
3. 语音卡片可折叠展开，显示设备选择、模式切换、测试按钮
4. 麦克风按钮出现在 Prompt 输入区右侧（发送按钮旁边）
5. 点击麦克风请求权限 → 开始录音 → 语音实时转文字填入输入框
6. 语音控制模式可匹配 send/clear/new/undo/redo 命令
7. 不支持 SpeechRecognition 的浏览器：麦克风按钮隐藏，功能中心显示"不支持"
8. `bun typecheck` 通过
