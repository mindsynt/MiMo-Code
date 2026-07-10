interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionErrorEvent {
  error: string
  message?: string
}

type SpeechRecognitionConstructor = new () => SpeechRecognition

function getRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return
  return (
    (window as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
  )
}

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
  return !!getRecognitionCtor()
}

export function isUserMediaSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
}

export function enumerateAudioDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return Promise.resolve([])
  return navigator.mediaDevices.enumerateDevices().then((devices) => devices.filter((d) => d.kind === "audioinput"))
}

export function createSpeechRecognizer(options: SpeechRecognizerOptions): SpeechRecognizerHandle {
  const Ctor = getRecognitionCtor()
  let recognition: SpeechRecognition | undefined
  let running = false

  if (!Ctor) {
    return {
      start() {},
      stop() {},
      abort() {},
      get isRunning() {
        return false
      },
    }
  }

  return {
    start() {
      if (running) return
      recognition = new Ctor()
      recognition.lang = options.language ?? navigator.language
      recognition.continuous = options.continuous ?? true
      recognition.interimResults = options.interimResults ?? true

      recognition.onresult = (event) => {
        let interimText = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0].transcript
          if (result.isFinal) {
            options.onResult?.(transcript, true)
          } else {
            interimText += transcript
          }
        }
        if (interimText) options.onResult?.(interimText, false)
      }

      recognition.onerror = (event) => {
        options.onError?.(event.error)
      }

      recognition.onend = () => {
        running = false
        options.onEnd?.()
      }

      running = true
      recognition.start()
    },

    stop() {
      recognition?.stop()
    },

    abort() {
      recognition?.abort()
    },

    get isRunning() {
      return running
    },
  }
}

// --- VAD-based real-time recording & ASR (matches TUI behavior) ---

const VAD_SAMPLE_RATE = 16000
const VAD_FRAME_MS = 30 // 30ms frames like TUI
const VAD_FRAME_SIZE = Math.floor((VAD_SAMPLE_RATE * VAD_FRAME_MS) / 1000) // 480 samples
const SILENCE_THRESHOLD = 0.001 // RMS energy threshold for silence
const SILENCE_SEGMENT_MS = 800 // ms of silence before ending segment
const MIN_SEGMENT_MS = 400 // minimum speech segment length
const MAX_SEGMENT_MS = 10_000 // max segment length before forced transcription

export interface VadRecorderOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  deviceId?: string
  onInterim?: (text: string) => void
  onSegment?: (text: string) => void
  onError?: (error: string) => void
  onStateChange?: (state: VadState) => void
}

export type VadState = "idle" | "listening" | "speaking" | "transcribing"

export interface VadRecorderHandle {
  start: () => Promise<void>
  stop: () => Promise<string>
  abort: () => void
  isRunning: boolean
}

/** Simple RMS energy-based voice activity detection */
class EnergyVAD {
  private buffer: Float32Array = new Float32Array(0)
  private speaking = false
  private silenceFrames = 0
  private segmentSamples: Float32Array = new Float32Array(0)
  private segmentStartTime = 0
  private lastActivityMs = 0

  private readonly frameSize: number
  private readonly silenceFramesMax: number
  private readonly minSegmentSamples: number
  private readonly maxSegmentSamples: number

  constructor() {
    this.frameSize = VAD_FRAME_SIZE
    this.silenceFramesMax = Math.ceil(((SILENCE_SEGMENT_MS / 1000) * VAD_SAMPLE_RATE) / this.frameSize)
    this.minSegmentSamples = Math.floor((MIN_SEGMENT_MS / 1000) * VAD_SAMPLE_RATE)
    this.maxSegmentSamples = Math.floor((MAX_SEGMENT_MS / 1000) * VAD_SAMPLE_RATE)
  }

  reset() {
    this.buffer = new Float32Array(0)
    this.speaking = false
    this.silenceFrames = 0
    this.segmentSamples = new Float32Array(0)
    this.segmentStartTime = 0
    this.lastActivityMs = 0
  }

  /** Feed PCM samples (Float32Array, normalized -1..1). Returns completed audio segment or null. */
  feed(samples: Float32Array): Float32Array | null {
    // Append to buffer
    const newBuf = new Float32Array(this.buffer.length + samples.length)
    newBuf.set(this.buffer)
    newBuf.set(samples, this.buffer.length)
    this.buffer = newBuf

    let result: Float32Array | null = null
    const now = Date.now()

    // Process complete frames
    while (this.buffer.length >= this.frameSize) {
      const frame = this.buffer.slice(0, this.frameSize)
      this.buffer = this.buffer.slice(this.frameSize)

      // Calculate RMS energy
      let sumSq = 0
      for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i]
      const rms = Math.sqrt(sumSq / frame.length)
      const isSpeech = rms > SILENCE_THRESHOLD

      // DEBUG: log when speech transitions occur (first time only)
      if (isSpeech && !this.speaking) {
        console.log("[vad] speech STARTED, rms:", rms.toFixed(6))
      } else if (!isSpeech && this.speaking && this.silenceFrames === 0) {
        console.log("[vad] speech STOPPED (entering silence)")
      }

      if (isSpeech) {
        this.lastActivityMs = now
        if (!this.speaking) {
          this.speaking = true
          this.segmentStartTime = now
          this.silenceFrames = 0
        }
        // Accumulate samples
        const newSeg = new Float32Array(this.segmentSamples.length + frame.length)
        newSeg.set(this.segmentSamples)
        newSeg.set(frame, this.segmentSamples.length)
        this.segmentSamples = newSeg

        // Check max segment duration
        if (this.segmentSamples.length >= this.maxSegmentSamples) {
          result = this.segmentSamples
          this.segmentSamples = new Float32Array(0)
          this.speaking = false
          this.silenceFrames = 0
        }
      } else {
        if (this.speaking) {
          // Still accumulate silence (needed for VAD continuity)
          const newSeg = new Float32Array(this.segmentSamples.length + frame.length)
          newSeg.set(this.segmentSamples)
          newSeg.set(frame, this.segmentSamples.length)
          this.segmentSamples = newSeg

          this.silenceFrames++
          if (this.silenceFrames >= this.silenceFramesMax) {
            // End of speech segment
            if (this.segmentSamples.length >= this.minSegmentSamples) {
              result = this.segmentSamples
            }
            this.segmentSamples = new Float32Array(0)
            this.speaking = false
            this.silenceFrames = 0
          }
        }
      }
    }

    return result
  }

  /** Force-flush any remaining audio as a segment */
  flush(): Float32Array | null {
    if (this.segmentSamples.length >= this.minSegmentSamples) {
      const result = this.segmentSamples
      this.segmentSamples = new Float32Array(0)
      this.speaking = false
      this.silenceFrames = 0
      return result
    }
    return null
  }

  isCurrentlySpeaking(): boolean {
    return this.speaking
  }
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  // Chunk at 32KB to avoid stack overflow from ...spread on large arrays (B1 fix)
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  }
  return btoa(binary)
}

export function createVadRecorder(options: VadRecorderOptions): VadRecorderHandle {
  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let processor: ScriptProcessorNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let running = false
  let state: VadState = "idle"
  let accumulatedText = ""

  const vad = new EnergyVAD()
  const model = options.model || "mimo-v2.5-asr"

  function setState(s: VadState) {
    state = s
    options.onStateChange?.(s)
  }

  function cleanup() {
    if (processor) {
      processor.onaudioprocess = null
      processor.disconnect()
    }
    if (source) source.disconnect()
    if (audioCtx) audioCtx.close()
    if (stream) stream.getTracks().forEach((t) => t.stop())
    processor = null
    source = null
    audioCtx = null
    stream = null
    running = false
  }

  async function transcribe(samples: Float32Array): Promise<string | null> {
    setState("transcribing")
    const pcm = float32ToInt16(samples)
    const wavBuf = encodeWav(pcm)
    const base64 = arrayBufferToBase64(wavBuf) // B1/B6 fix: no spread overflow
    const dataUrl = `data:audio/wav;base64,${base64}`

    // 先尝试通过 /api/transcribe 代理（开发/预览模式）
    const text = await proxyTranscribe(dataUrl, model)
    if (text !== null) return text

    // 代理失败时直接调用 provider API（生产环境回退）
    return directTranscribe(base64, model)
  }

  /** 通过 Vite 代理 /api/transcribe 发送转录请求 */
  async function proxyTranscribe(audio: string, model: string): Promise<string | null> {
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio,
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model,
        }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { text?: string; error?: string }
      if (data.text) return data.text
      if (data.error) options.onError?.(data.error)
    } catch {
      // 代理不可用（404/网络错误），返回 null 让上层尝试直连
    }
    return null
  }

  /** 直接调用 provider API（不使用代理，生产环境回退） */
  async function directTranscribe(base64: string, model: string): Promise<string | null> {
    const base = (options.baseUrl || "https://api.xiaomimimo.com/v1").replace(/\/+$/, "")
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${base64}` } }],
            },
          ],
          asr_options: { language: "auto" },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return null
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content?.trim() || null
    } catch {
      options.onError?.("Transcription failed (both proxy and direct)")
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async start() {
      if (running) return
      accumulatedText = ""
      vad.reset()
      setState("listening")

      try {
        // B11 fix: pass deviceId if specified
        const constraints: MediaStreamConstraints = { audio: true }
        if (options.deviceId) {
          constraints.audio = { deviceId: { exact: options.deviceId } }
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        audioCtx = new AudioContext()
        // Ensure AudioContext is running (browser autoplay policy may suspend it)
        if (audioCtx.state === "suspended") await audioCtx.resume()
        source = audioCtx.createMediaStreamSource(stream)
        processor = audioCtx.createScriptProcessor(4096, 1, 1)
        source.connect(processor)
        // Connect to destination via zero-gain node to ensure onaudioprocess fires
        const muteGain = audioCtx.createGain()
        muteGain.gain.value = 0
        processor.connect(muteGain)
        muteGain.connect(audioCtx.destination)
        // Do NOT connect processor to destination (avoid feedback)

        running = true

        processor.onaudioprocess = (event) => {
          if (!running) return
          const input = event.inputBuffer.getChannelData(0)

          const segment = vad.feed(input)

          if (segment) {
            if (!vad.isCurrentlySpeaking()) setState("listening")
            else setState("speaking")

            // B4 fix: capture running state, check before modifying
            transcribe(segment).then((text) => {
              if (!running) return // transcription finished after stop/abort
              if (text) {
                accumulatedText += (accumulatedText ? " " : "") + text
                options.onSegment?.(text)
              }
              if (!running) return
              if (vad.isCurrentlySpeaking()) setState("speaking")
              else setState("listening")
            })
          } else if (vad.isCurrentlySpeaking()) {
            setState("speaking")
          } else {
            setState("listening")
          }
        }

        setState("listening")
      } catch (err: unknown) {
        // B3 fix: cleanup before throwing
        cleanup()
        setState("idle")
        throw err
      }
    },

    stop() {
      return new Promise<string>((resolve) => {
        const remaining = vad.flush()
        const doFlush = async () => {
          if (remaining) {
            const text = await transcribe(remaining)
            // B4 fix: check running (might have been aborted during transcribe)
            if (running && text) accumulatedText += (accumulatedText ? " " : "") + text
          }
          cleanup()
          setState("idle")
          resolve(accumulatedText)
        }
        doFlush()
      })
    },

    abort() {
      cleanup()
      setState("idle")
    },

    get isRunning() {
      return running
    },
  }
}

export function encodeWav(samples: Int16Array): ArrayBuffer {
  const sampleRate = 16000
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, "WAVE")
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, "data")
  view.setUint32(40, dataSize, true)
  new Int16Array(buffer, 44).set(samples)
  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}
