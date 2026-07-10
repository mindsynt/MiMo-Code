import { createSimpleContext } from "@mimo-ai/ui/context"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  createSpeechRecognizer,
  createVadRecorder,
  enumerateAudioDevices,
  isSpeechSupported,
  isUserMediaSupported,
  type SpeechRecognizerHandle,
  type VadRecorderHandle,
  type VadState,
} from "@/utils/voice"

export interface VoiceState {
  isSupported: boolean
  isMediaRecorder: boolean
  isListening: Accessor<boolean>
  transcript: Accessor<string>
  interimTranscript: Accessor<string>
  vadState: Accessor<VadState>
  error: Accessor<string | null>
  deviceId: Accessor<string>
  voiceControl: Accessor<boolean>
  voiceSend: Accessor<boolean>
  devices: Accessor<MediaDeviceInfo[]>
}

export interface VoiceActions {
  startListening: () => void
  stopListening: () => Promise<string | void>
  toggleListening: () => void
  setDeviceId: (id: string) => void
  setVoiceControl: (on: boolean) => void
  setVoiceSend: (on: boolean) => void
  refreshDevices: () => void
  setOnCommand?: (handler: (cmd: string) => void) => void
  setOnSend?: (handler: () => void) => void
  setAsrCredentials: (creds: { apiKey: string; baseUrl?: string }) => void
  /** 注册语音识别段实时推送回调——每个isFinal段/VAD段触发，实现边说边出字 */
  setOnLiveTranscript?: (handler: ((text: string) => void) | undefined) => void
}

interface VoiceCommand {
  pattern: RegExp
  action: string
}

const VOICE_COMMANDS: VoiceCommand[] = [
  { pattern: /^(send|submit|go|发送|提交)$/i, action: "send" },
  { pattern: /^(clear|erase|清空|清除)$/i, action: "clear" },
  { pattern: /^(new|new.session|新建|新会话)$/i, action: "new" },
  { pattern: /^(undo|撤销)$/i, action: "undo" },
  { pattern: /^(redo|重做)$/i, action: "redo" },
]

export type VoiceContextValue = VoiceState & VoiceActions

function localeToSpeechLang(locale: string): string {
  if (locale === "zh") return "cmn-Hans-CN"
  if (locale === "ja") return "ja-JP"
  return "en-US"
}

export const { use: useVoice, provider: VoiceProvider } = createSimpleContext({
  name: "Voice",
  gate: false,
  init: () => {
    const speechRecogAvailable = isSpeechSupported()
    const userMediaAvailable = isUserMediaSupported()
    const [isListening, setIsListening] = createSignal(false)
    const [transcript, setTranscript] = createSignal("")
    const [interimTranscript, setInterimTranscript] = createSignal("")
    const [vadState, setVadState] = createSignal<VadState>("idle")
    const [error, setError] = createSignal<string | null>(null)
    const [deviceId, setDeviceId] = createSignal("")
    const [voiceControl, setVoiceControl] = createSignal(false)
    const [voiceSend, setVoiceSend] = createSignal(false)
    const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([])
    const [commandHandler, setCommandHandler] = createSignal<((cmd: string) => void) | undefined>()
    const [sendHandler, setSendHandler] = createSignal<(() => void) | undefined>()
    const [asrCreds, setAsrCreds] = createSignal<{ apiKey: string; baseUrl?: string } | null>(null)
    const [liveHandler, setLiveHandler] = createSignal<((text: string) => void) | undefined>()

    let recognizer: SpeechRecognizerHandle | undefined
    let vadRecorder: VadRecorderHandle | undefined
    let transitionLock = false // B9/B15 fix: prevent rapid start/stop races
    let endResolve: (() => void) | null = null // resolves when SpeechRecognition fires onEnd
    let isStopping = false // guard against concurrent stopListening calls

    const lang = useLanguage()

    const refreshDevices = () => {
      enumerateAudioDevices()
        .then(setDevices)
        .catch(() => {}) // B7 fix: handle rejection
    }

    createEffect(() => {
      refreshDevices()
    })

    const handleFinalText = (text: string) => {
      if (voiceControl()) {
        const matched = VOICE_COMMANDS.find((cmd) => cmd.pattern.test(text.trim()))
        if (matched) {
          commandHandler()?.(matched.action)
          setTranscript("")
          setInterimTranscript("")
          return
        }
      }
      if (voiceSend()) {
        const sendMatch = /^(send|submit|go|发送|提交)$/i.test(text.trim())
        if (sendMatch) {
          sendHandler()?.()
          setTranscript("")
          setInterimTranscript("")
          return
        }
      }
      // B8 fix: add space between segments
      setTranscript((prev) => prev + (prev ? " " : "") + text)
      setInterimTranscript("")
      // 实时推送每个识别段，实现边说边出字
      liveHandler()?.(text)
    }

    const startListening = () => {
      // B9/B15 fix: skip if transition in progress
      if (transitionLock) return
      setError(null)
      setTranscript("")
      setInterimTranscript("")

      if (speechRecogAvailable) {
        // Path A: Web Speech API (Chrome/Edge/Safari)
        const speechLang = localeToSpeechLang(lang.locale())
        transitionLock = true
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            // 立刻释放 getUserMedia 流——SpeechRecognition 有自己的麦克风管理
            stream.getTracks().forEach((t) => t.stop())

            recognizer = createSpeechRecognizer({
              language: speechLang,
              continuous: true,
              interimResults: true,
              onResult(text, isFinal) {
                if (isFinal) handleFinalText(text)
                else setInterimTranscript(text)
              },
              onError(err) {
                endResolve?.()
                endResolve = null
                setError(err)
                setIsListening(false)
                transitionLock = false
              },
              onEnd() {
                endResolve?.()
                endResolve = null
                setIsListening(false)
                transitionLock = false
              },
            })
            recognizer.start()
            setIsListening(true)
            transitionLock = false
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Microphone access denied")
            transitionLock = false
          })
      } else {
        // Path B: VAD + ASR proxy (Firefox, matches TUI behavior)
        console.log("[voice] using VAD+ASR proxy (MediaRecorder fallback)")
        const creds = asrCreds()
        if (!creds?.apiKey) {
          console.warn("[voice] no ASR credentials found in provider config")
          setError("ASR credentials not configured. Please connect a Xiaomi provider.")
          return
        }
        console.log("[voice] ASR credentials ready, starting VAD recorder")

        vadRecorder = createVadRecorder({
          apiKey: creds.apiKey,
          baseUrl: creds.baseUrl,
          deviceId: deviceId() || undefined, // B11 fix: pass selected device
          onInterim(text) {
            setInterimTranscript(text)
          },
          onSegment(text) {
            setTranscript((prev) => prev + (prev ? " " : "") + text)
            setInterimTranscript("")
            liveHandler()?.(text)
          },
          onError(err) {
            setError(err)
          },
          onStateChange(state) {
            setVadState(state)
            if (state === "idle") setIsListening(false)
          },
        })

        vadRecorder
          .start()
          .then(() => {
            setIsListening(true)
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Failed to start recording")
            setIsListening(false)
          })
      }
    }

    const stopListening = async () => {
      let finalText = ""
      if (recognizer && !isStopping) {
        isStopping = true
        recognizer.stop()
        recognizer = undefined
        // 等待 SpeechRecognition 触发 onEnd（此时所有待处理的 onresult 已完成）
        // 确保尾部文本不会丢失
        await new Promise<void>((resolve) => {
          endResolve = resolve
          // 安全超时：如果 onEnd 3 秒内未触发（异常情况），强制继续
          setTimeout(() => {
            if (endResolve === resolve) {
              endResolve = null
              resolve()
            }
          }, 3000)
        })
        isStopping = false
        // onEnd 回调负责 setIsListening(false) 和 transitionLock = false
      }
      if (vadRecorder) {
        const flushText = await vadRecorder.stop()
        vadRecorder = undefined
        setIsListening(false)
        // 确保 flush 转写的结果追加到 transcript 信号中
        // （createVadRecorder 的 onSegment 在停止时可能未触发最后一次转写）
        if (flushText && !transcript().endsWith(flushText)) {
          setTranscript((prev) => prev + (prev ? " " : "") + flushText)
        }
      }
      finalText = transcript()
      return finalText
    }

    const toggleListening = async () => {
      if (isListening()) await stopListening()
      else startListening()
    }

    onCleanup(() => {
      recognizer?.abort()
      vadRecorder?.abort()
    })

    return {
      isSupported: speechRecogAvailable,
      isMediaRecorder: !speechRecogAvailable && userMediaAvailable,
      isListening,
      transcript,
      interimTranscript,
      vadState,
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
      // 显式转型为直接赋值形式，避免 TypeScript 将参数匹配到 Setter 的 updater 重载
      setOnCommand: (handler: ((cmd: string) => void) | undefined) =>
        (setCommandHandler as (v: ((cmd: string) => void) | undefined) => void)(handler),
      setOnSend: (handler: (() => void) | undefined) =>
        (setSendHandler as (v: (() => void) | undefined) => void)(handler),
      setAsrCredentials: setAsrCreds,
      setOnLiveTranscript: (handler: ((text: string) => void) | undefined) =>
        (setLiveHandler as (v: ((text: string) => void) | undefined) => void)(handler),
    }
  },
})
