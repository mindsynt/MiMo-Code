import { For, Show } from "solid-js"
import { Button } from "@mimo-ai/ui/button"
import { Switch } from "@mimo-ai/ui/switch"
import { useVoice } from "@/context/voice"
import { useLanguage } from "@/context/language"

export const VoicePanel = () => {
  const voice = useVoice()
  const language = useLanguage()

  const statusLabel = () => {
    if (!voice.isSupported && !voice.isMediaRecorder) return language.t("voice.notSupported")
    if (!voice.isListening()) return language.t("voice.ready")
    const state = voice.vadState()
    if (state === "speaking") return language.t("voice.speaking")
    if (state === "transcribing") return language.t("voice.transcribing")
    if (state === "listening") return language.t("voice.listening")
    return language.t("voice.listening")
  }

  const statusClass = () => {
    if (!voice.isSupported && !voice.isMediaRecorder) return "text-text-weak"
    if (!voice.isListening()) return "text-icon-success-base"
    const state = voice.vadState()
    if (state === "speaking") return "text-icon-critical-base animate-pulse"
    if (state === "transcribing") return "text-icon-warning-base"
    return "text-icon-success-base"
  }

  return (
    <div class="flex flex-col gap-3">
      {/* Unsupported browser notice - only when both SpeechRecog and VAD are unavailable */}
      <Show when={!voice.isSupported && !voice.isMediaRecorder}>
        <div class="bg-surface-warning-weak text-text-on-warning-base text-14-regular px-3 py-2 rounded-md flex flex-col gap-1">
          <span class="text-14-medium">{language.t("voice.browserNotSupported")}</span>
          <span class="text-12-regular text-text-weak">{language.t("voice.browserHint")}</span>
        </div>
      </Show>

      {/* Status indicator */}
      <div class="flex items-center justify-between">
        <span class="text-14-regular text-text-strong">{language.t("voice.status")}</span>
        <span class={`text-14-regular ${statusClass()}`}>{statusLabel()}</span>
      </div>

      {/* Error display */}
      <Show when={voice.error()}>
        <div class="bg-surface-critical-base text-text-critical text-13-regular px-2 py-1 rounded-md">
          {voice.error()}
        </div>
      </Show>

      {/* Device selection */}
      <div class="flex flex-col gap-1">
        <label for="voice-device" class="text-14-regular text-text-strong">
          {language.t("voice.device")}
        </label>
        <select
          id="voice-device"
          class="w-full px-2 py-1.5 text-14-regular bg-surface-base border border-border-weak-base rounded-md text-text-strong focus:outline-none focus:border-border-strong-base"
          value={voice.deviceId()}
          onChange={(e) => voice.setDeviceId(e.currentTarget.value)}
        >
          <option value="">{language.t("voice.error.noDevice")}</option>
          <For each={voice.devices()}>
            {(device) => (
              <option value={device.deviceId}>
                {device.label || `Microphone (${device.deviceId.slice(0, 8)}...)`}
              </option>
            )}
          </For>
        </select>
      </div>

      {/* Voice control mode toggle */}
      <div class="flex items-center justify-between">
        <span class="text-14-regular text-text-strong">{language.t("voice.control")}</span>
        <Switch checked={voice.voiceControl()} onChange={(checked) => voice.setVoiceControl(checked)} />
      </div>

      {/* Voice send toggle */}
      <div class="flex items-center justify-between">
        <span class="text-14-regular text-text-strong">{language.t("voice.send")}</span>
        <Switch checked={voice.voiceSend()} onChange={(checked) => voice.setVoiceSend(checked)} />
      </div>

      {/* Test microphone button */}
      <Button variant="secondary" onClick={() => voice.toggleListening()}>
        {voice.isListening() ? language.t("voice.stop.test") : language.t("voice.test")}
      </Button>
    </div>
  )
}
