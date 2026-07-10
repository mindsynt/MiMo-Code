# 功能中心框架 + 语音输入模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "功能中心" (Feature Center) sidebar panel framework and the first feature module — Voice Input — in the web frontend (`packages/app`).

**Architecture:** A new sidebar panel accessible via a button in the sidebar rail, containing collapsible feature cards. Voice input uses the Web Speech API (`SpeechRecognition`) with a microphone button in the prompt area and a configuration card in the feature center panel.

**Tech Stack:** SolidJS 1.9.x, SolidJS Context API, Tailwind CSS 4, `@mimo-ai/ui` components, Web Speech API, `@kobalte/core`

## Global Constraints

- Follow existing code patterns in `packages/app/src/` (functional components, `createContext`/`useContext`, TypeScript strict)
- Use `@mimo-ai/ui/icon-button` for icon buttons
- Use `@mimo-ai/ui/tooltip` for tooltips
- Follow the existing sidebar-rail layout pattern (TooltipKeybind for labeled buttons)
- i18n: Add voice-related strings to the i18n system (check `src/locales/en.ts` for pattern)
- No external dependencies — Web Speech API is browser-native
- Unsupported browsers (no SpeechRecognition): hide microphone button, show "not supported" in config card

---

### Task 1: FeatureCenterProvider context + FeatureCard component

**Covers:** [S3.5]

**Files:**

- Create: `packages/app/src/context/feature-center.tsx`
- Create: `packages/app/src/components/feature-center/feature-card.tsx`

**Interfaces:**

- Consumes: nothing from other tasks
- Produces: `FeatureCardProps` type, `FeatureCenterProvider` component, `useFeatureCenter` hook

- [ ] **Step 1: Create FeatureCard component**

```tsx
// packages/app/src/components/feature-center/feature-card.tsx
import { createSignal, type JSX } from "solid-js"
import { IconButton } from "@mimo-ai/ui/icon-button"

interface FeatureCardProps {
  icon: string
  title: string
  description: string
  children: JSX.Element
  defaultOpen?: boolean
}

export const FeatureCard = (props: FeatureCardProps) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)

  return (
    <div class="border-b border-border-base last:border-b-0">
      <button
        onClick={() => setOpen(!open())}
        class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised-hover transition-colors"
      >
        <span class="text-lg">{props.icon}</span>
        <div class="flex-1 min-w-0">
          <div class="text-14-medium text-text-strong truncate">{props.title}</div>
          <div class="text-12-regular text-text-weak truncate">{props.description}</div>
        </div>
        <IconButton
          icon={open() ? "chevron-up" : "chevron-down"}
          variant="ghost"
          size="small"
          aria-label={open() ? "collapse" : "expand"}
        />
      </button>
      {open() && <div class="px-4 pb-4">{props.children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Create FeatureCenterProvider context**

```tsx
// packages/app/src/context/feature-center.tsx
import { createContext, useContext, createSignal, type Accessor, type JSX, type Setter } from "solid-js"

interface FeatureCenterContextValue {
  open: Accessor<boolean>
  setOpen: Setter<boolean>
}

const FeatureCenterContext = createContext<FeatureCenterContextValue>()

export const FeatureCenterProvider = (props: { children: JSX.Element }) => {
  const [open, setOpen] = createSignal(false)

  return <FeatureCenterContext.Provider value={{ open, setOpen }}>{props.children}</FeatureCenterContext.Provider>
}

export const useFeatureCenter = () => {
  const ctx = useContext(FeatureCenterContext)
  if (!ctx) throw new Error("useFeatureCenter must be used within FeatureCenterProvider")
  return ctx
}
```

- [ ] **Step 3: Create the i18n strings for feature center**

(In src/locales directory, find the en.ts and add voice-related strings. This step adds the base feature-center string.)

Edit the location where i18n strings are defined (search for "prompt.action.send" pattern). Add:

```ts
"featureCenter.title": "Feature Center",
"featureCenter.voice.title": "Voice Input",
"featureCenter.voice.description": "Speech-to-text via microphone",
```

- [ ] **Step 4: Verify compilation**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/context/feature-center.tsx packages/app/src/components/feature-center/feature-card.tsx
git commit -m "feat(web): add FeatureCenter provider and FeatureCard component"
```

---

### Task 2: FeatureCenterButton + FeatureCenterSidebar panel (sidebar integration)

**Covers:** [S3.1, S3.2, S3.3]

**Files:**

- Create: `packages/app/src/pages/layout/feature-center-button.tsx`
- Create: `packages/app/src/pages/layout/feature-center.tsx`
- Modify: `packages/app/src/pages/layout/sidebar-shell.tsx`
- Modify: `packages/app/src/pages/layout.tsx`

**Interfaces:**

- Consumes: `useFeatureCenter` from Task 1, `FeatureCard` from Task 1
- Produces: Feature center sidebar panel with slots for feature cards

- [ ] **Step 1: Create FeatureCenterButton component**

```tsx
// packages/app/src/pages/layout/feature-center-button.tsx
import { IconButton } from "@mimo-ai/ui/icon-button"
import { TooltipKeybind } from "@mimo-ai/ui/tooltip"
import { useFeatureCenter } from "@/context/feature-center"
import type { Accessor } from "solid-js"

export const FeatureCenterButton = (props: { placement: () => "bottom" | "right" }) => {
  const { open, setOpen } = useFeatureCenter()

  return (
    <TooltipKeybind placement={props.placement()} title="Feature Center" keybind="">
      <IconButton
        icon={open() ? "bolt" : "bolt"}
        variant={open() ? "secondary" : "ghost"}
        size="large"
        onClick={() => setOpen(!open())}
        aria-label="Feature Center"
      />
    </TooltipKeybind>
  )
}
```

- [ ] **Step 2: Create FeatureCenter sidebar panel**

```tsx
// packages/app/src/pages/layout/feature-center.tsx
import { FeatureCard } from "@/components/feature-center/feature-card"
import { VoicePanel } from "../feature-center/voice-panel"

export const FeatureCenterPanel = () => {
  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="shrink-0 px-4 py-3 border-b border-border-base">
        <h2 class="text-16-medium text-text-strong">Feature Center</h2>
      </div>
      <div class="flex-1 overflow-y-auto no-scrollbar">
        <FeatureCard icon="🎤" title="Voice Input" description="Speech-to-text via microphone">
          <VoicePanel />
        </FeatureCard>
        {/* Future feature cards will be added here */}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Modify sidebar-shell.tsx — add `onOpenFeatureCenter` prop and render button**

Add to the SidebarContent props interface:

```tsx
featureCenterLabel: Accessor<string>
onOpenFeatureCenter: () => void
```

Add the button between settings and help (line 102, before help):

```tsx
<FeatureCenterButton placement={placement} />
```

- [ ] **Step 4: Modify layout.tsx — wire feature center**

1. Import `FeatureCenterProvider`, `FeatureCenterPanel`, `FeatureCenterButton`
2. Wrap the sidebar area with `<FeatureCenterProvider>`
3. Pass `onOpenFeatureCenter={() => {...}}` to SidebarContent
4. Modify `renderPanel` to alternate between `SidebarPanel` and `FeatureCenterPanel` based on `featureCenter.open()`

```tsx
renderPanel={() =>
  featureCenter.open()
    ? <FeatureCenterPanel />
    : mobile
      ? <SidebarPanel project={currentProject} mobile />
      : <SidebarPanel project={currentProject} merged />
}
```

- [ ] **Step 5: Verify compilation**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/layout/feature-center-button.tsx packages/app/src/pages/layout/feature-center.tsx packages/app/src/pages/layout/sidebar-shell.tsx packages/app/src/pages/layout.tsx
git commit -m "feat(web): add feature center sidebar panel framework"
```

---

### Task 3: Voice utility + VoiceProvider

**Covers:** [S4.1, S4.3, S4.6]

**Files:**

- Create: `packages/app/src/utils/voice.ts`
- Create: `packages/app/src/context/voice.tsx`

**Interfaces:**

- Consumes: nothing from other tasks
- Produces: `VoiceProvider`, `useVoice` hook, `VoiceState` type

- [ ] **Step 1: Create voice utility (Web Speech API wrapper)**

```ts
// packages/app/src/utils/voice.ts

export interface VoiceState {
  isSupported: boolean
  isListening: boolean
  transcript: string
  interimTranscript: string
  error: string | null
  deviceId: string
  devices: MediaDeviceInfo[]
}

export type VoiceEvent =
  | { type: "result"; transcript: string; interim: string }
  | { type: "end"; final: string }
  | { type: "error"; message: string }
  | { type: "device-list"; devices: MediaDeviceInfo[] }

export function createVoiceEngine(onEvent: (event: VoiceEvent) => void) {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const isSupported = !!SpeechRecognition

  let recognition: any = null
  let mediaStream: MediaStream | null = null

  function start(lang: string = "en-US") {
    if (!isSupported) return
    recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let interim = ""
      let final = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      onEvent({ type: "result", transcript: final || interim, interim })
    }

    recognition.onend = () => {
      if (recognition) {
        // Auto-restart if still listening
        try {
          recognition.start()
        } catch {}
      }
    }

    recognition.onerror = (event: any) => {
      onEvent({ type: "error", message: event.error })
    }

    recognition.start()
  }

  function stop(): Promise<string> {
    return new Promise((resolve) => {
      if (recognition) {
        recognition.onend = () => {
          resolve("")
        }
        recognition.stop()
        recognition = null
      } else {
        resolve("")
      }
    })
  }

  async function getDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter((d) => d.kind === "audioinput")
      onEvent({ type: "device-list", devices: audioInputs })
      return audioInputs
    } catch {
      return []
    }
  }

  function cleanup() {
    if (recognition) {
      recognition.stop()
      recognition = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop())
      mediaStream = null
    }
  }

  return { start, stop, getDevices, cleanup, isSupported }
}
```

- [ ] **Step 2: Create VoiceProvider context**

```tsx
// packages/app/src/context/voice.tsx
import { createContext, useContext, createSignal, createEffect, onCleanup, type JSX } from "solid-js"
import { createVoiceEngine, type VoiceState } from "@/utils/voice"
import { useLanguage } from "./language"

interface VoiceContextValue {
  voice: VoiceState
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
  setDeviceId: (id: string) => void
  voiceControl: () => boolean
  setVoiceControl: (v: boolean) => void
  voiceSend: () => boolean
  setVoiceSend: (v: boolean) => void
  refreshDevices: () => void
}

const VoiceContext = createContext<VoiceContextValue>()

export const VoiceProvider = (props: { children: JSX.Element }) => {
  const language = useLanguage()
  const [isSupported, setIsSupported] = createSignal(false)
  const [isListening, setIsListening] = createSignal(false)
  const [transcript, setTranscript] = createSignal("")
  const [interimTranscript, setInterimTranscript] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [deviceId, setDeviceId] = createSignal("")
  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([])
  const [voiceCtrl, setVoiceCtrl] = createSignal(false)
  const [voiceSnd, setVoiceSnd] = createSignal(false)

  const engine = createVoiceEngine((event) => {
    if (event.type === "result") {
      setTranscript(event.transcript)
      setInterimTranscript(event.interim)
    }
    if (event.type === "error") {
      setError(event.message)
    }
    if (event.type === "device-list") {
      setDevices(event.devices)
    }
  })

  setIsSupported(engine.isSupported)

  const startListening = () => {
    if (!engine.isSupported) return
    setError(null)
    setTranscript("")
    try {
      engine.start(language.language() === "zh" ? "zh-CN" : "en-US")
      setIsListening(true)
    } catch (e: any) {
      setError(e.message)
      setIsListening(false)
    }
  }

  const stopListening = async () => {
    await engine.stop()
    setIsListening(false)
  }

  const toggleListening = () => {
    if (isListening()) stopListening()
    else startListening()
  }

  const refreshDevices = () => {
    engine.getDevices().then((d) => setDevices(d))
  }

  // Auto-refresh devices on mount
  createEffect(() => {
    refreshDevices()
  })

  onCleanup(() => {
    engine.cleanup()
  })

  return (
    <VoiceContext.Provider
      value={{
        voice: {
          isSupported: isSupported(),
          isListening: isListening(),
          transcript: transcript(),
          interimTranscript: interimTranscript(),
          error: error(),
          deviceId: deviceId(),
          devices: devices(),
        },
        startListening,
        stopListening,
        toggleListening,
        setDeviceId,
        voiceControl: voiceCtrl,
        setVoiceControl: setVoiceCtrl,
        voiceSend: voiceSnd,
        setVoiceSend: setVoiceSnd,
        refreshDevices,
      }}
    >
      {props.children}
    </VoiceContext.Provider>
  )
}

export const useVoice = () => {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider")
  return ctx
}
```

- [ ] **Step 3: Verify compilation**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/utils/voice.ts packages/app/src/context/voice.tsx
git commit -m "feat(web): add voice input engine and VoiceProvider context"
```

---

### Task 4: VoiceButton component + prompt input integration

**Covers:** [S4.2, S4.4]

**Files:**

- Create: `packages/app/src/components/voice/voice-button.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/pages/session.tsx` (wrap VoiceProvider in session context)
- Modify: i18n locale files (add voice-related strings)

**Interfaces:**

- Consumes: `useVoice` from Task 3, `useLanguage` for locale
- Produces: Microphone button in prompt area

- [ ] **Step 1: Create VoiceButton component**

```tsx
// packages/app/src/components/voice/voice-button.tsx
import { IconButton } from "@mimo-ai/ui/icon-button"
import { Tooltip } from "@mimo-ai/ui/tooltip"
import { useVoice } from "@/context/voice"

export const VoiceButton = () => {
  const { voice, toggleListening } = useVoice()

  if (!voice.isSupported) return null

  return (
    <Tooltip placement="top" value={voice.isListening ? "Stop recording" : "Voice input"}>
      <IconButton
        data-action="prompt-voice"
        icon="mic"
        variant={voice.isListening ? "secondary" : "ghost"}
        size="small"
        classList={{
          "text-accent animate-pulse": voice.isListening,
        }}
        onClick={toggleListening}
        aria-label={voice.isListening ? "Stop recording" : "Voice input"}
      />
    </Tooltip>
  )
}
```

- [ ] **Step 2: Add VoiceButton to prompt-input.tsx**

In the submit button container (line 1422), add the VoiceButton before the submit button:

```tsx
<div class="flex items-center gap-1 pointer-events-auto">
  <VoiceButton />
  <Tooltip placement="top" inactive={!working() && blank()} value={tip()}>
    <IconButton ... submit button />
  </Tooltip>
</div>
```

Also add the import at the top of prompt-input.tsx:

```tsx
import { VoiceButton } from "@/components/voice/voice-button"
```

- [ ] **Step 3: Wire VoiceProvider in session.tsx**

Wrap the session component with `<VoiceProvider>` so the voice context is available throughout the session view.

In the session page component (likely `pages/session.tsx`), wrap the relevant JSX:

```tsx
import { VoiceProvider } from "@/context/voice"

// Inside the session component render:
;<VoiceProvider>{/* ... existing session content ... */}</VoiceProvider>
```

- [ ] **Step 4: Verify compilation**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/voice/voice-button.tsx packages/app/src/components/prompt-input.tsx packages/app/src/pages/session.tsx
git commit -m "feat(web): add microphone voice button to prompt area"
```

---

### Task 5: VoicePanel configuration card (in feature center)

**Covers:** [S4.2, S4.3, S4.5, S4.6]

**Files:**

- Create: `packages/app/src/pages/feature-center/voice-panel.tsx`

**Interfaces:**

- Consumes: `useVoice` from Task 3

- [ ] **Step 1: Create VoicePanel config card**

```tsx
// packages/app/src/pages/feature-center/voice-panel.tsx
import { For, createEffect } from "solid-js"
import { useVoice } from "@/context/voice"
import { IconButton } from "@mimo-ai/ui/icon-button"

export const VoicePanel = () => {
  const {
    voice,
    startListening,
    stopListening,
    toggleListening,
    voiceControl,
    setVoiceControl,
    voiceSend,
    setVoiceSend,
    devices,
    refreshDevices,
  } = useVoice()

  const statusText = () => {
    if (!voice.isSupported) return "Not supported in this browser"
    if (voice.error) return `Error: ${voice.error}`
    if (voice.isListening) return "Recording..."
    return "Ready"
  }

  const statusClass = () => {
    if (!voice.isSupported || voice.error) return "text-destructive"
    if (voice.isListening) return "text-accent"
    return "text-success"
  }

  return (
    <div class="flex flex-col gap-3">
      {!voice.isSupported ? (
        <p class="text-12-regular text-text-weak">Voice input is not supported in this browser. Try Chrome or Edge.</p>
      ) : (
        <>
          {/* Status indicator */}
          <div class="flex items-center gap-2">
            <span class="text-12-medium text-text-strong">Status:</span>
            <span class={`text-12-regular ${statusClass()}`}>{statusText()}</span>
          </div>

          {/* Microphone selection */}
          <div class="flex flex-col gap-1">
            <label class="text-12-medium text-text-strong">Microphone</label>
            <select
              class="w-full rounded border border-border-base px-2 py-1 text-12-regular bg-surface-raised"
              onChange={(e) => setDeviceId(e.currentTarget.value)}
            >
              <For each={devices()}>
                {(device) => (
                  <option value={device.deviceId}>{device.label || `Microphone ${device.deviceId.slice(0, 8)}`}</option>
                )}
              </For>
            </select>
            <button class="text-12-regular text-accent hover:underline self-end" onClick={refreshDevices}>
              Refresh devices
            </button>
          </div>

          {/* Voice control mode toggle */}
          <div class="flex items-center justify-between">
            <span class="text-12-medium text-text-strong">Voice control mode</span>
            <button
              role="switch"
              aria-checked={voiceControl()}
              onClick={() => setVoiceControl(!voiceControl())}
              classList={{
                "w-10 h-5 rounded-full transition-colors": true,
                "bg-accent": voiceControl(),
                "bg-border-base": !voiceControl(),
              }}
            >
              <div
                classList={{
                  "w-4 h-4 rounded-full bg-white transition-transform": true,
                  "translate-x-5": voiceControl(),
                  "translate-x-0.5": !voiceControl(),
                }}
              />
            </button>
          </div>

          {/* Voice send toggle */}
          <div class="flex items-center justify-between">
            <span class="text-12-medium text-text-strong">Voice send</span>
            <button
              role="switch"
              aria-checked={voiceSend()}
              onClick={() => setVoiceSend(!voiceSend())}
              classList={{
                "w-10 h-5 rounded-full transition-colors": true,
                "bg-accent": voiceSend(),
                "bg-border-base": !voiceSend(),
              }}
            >
              <div
                classList={{
                  "w-4 h-4 rounded-full bg-white transition-transform": true,
                  "translate-x-5": voiceSend(),
                  "translate-x-0.5": !voiceSend(),
                }}
              />
            </button>
          </div>

          {/* Interim transcript display */}
          {voice.interimTranscript && (
            <div class="text-12-regular text-text-weak italic bg-surface-raised rounded p-2">
              {voice.interimTranscript}
            </div>
          )}

          {/* Test button */}
          <div class="flex gap-2">
            <IconButton
              icon={voice.isListening ? "stop" : "mic"}
              variant={voice.isListening ? "secondary" : "primary"}
              size="small"
              onClick={toggleListening}
              aria-label={voice.isListening ? "Stop test" : "Test microphone"}
            />
            <span class="text-12-regular text-text-weak self-center">
              {voice.isListening ? "Click to stop test" : "Test your microphone"}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/feature-center/voice-panel.tsx
git commit -m "feat(web): add voice input configuration panel in feature center"
```

---

### Task 6: Integration wiring + end-to-end verification

**Covers:** [S3.3, S7]

**Files:**

- Modify: `packages/app/src/pages/layout.tsx` (ensure VoiceProvider wraps session)
- Test: Manual E2E verification

**Interfaces:**

- Consumes: All tasks 1-5

- [ ] **Step 1: Verify all wiring is correct**

Check that:

1. `FeatureCenterProvider` wraps the sidebar area in `layout.tsx`
2. `VoiceProvider` wraps the session area in `session.tsx`
3. `VoiceButton` is imported in `prompt-input.tsx` and rendered before submit button
4. `FeatureCenterPanel` is rendered when `featureCenter.open()` is true

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck` from `packages/app/`
Expected: No type errors

- [ ] **Step 3: Manual verification checklist**

1. Feature center button appears in sidebar rail between settings and help
2. Clicking button opens the feature center panel
3. Voice Input card is visible and collapsible
4. In a supported browser (Chrome): microphone button appears in prompt area
5. Clicking microphone starts recording (requires microphone permission)
6. Speech is transcribed and appears in the input area
7. Config card shows status changes (Ready → Recording)
8. In unsupported browser: microphone button hidden, config card shows "not supported"

- [ ] **Step 4: Commit final wiring changes**

```bash
git add packages/app/src/pages/layout.tsx
git commit -m "feat(web): wire feature center and voice input into app layout"
```
