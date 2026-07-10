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

  // Show button when SpeechRecognition is supported OR when VAD recorder is available
  if (!voice.isSupported && !voice.isMediaRecorder) return null

  const handleClick = async () => {
    if (voice.isListening()) {
      const text = await voice.stopListening()
      if (text) props.onTranscript(text)
    } else {
      voice.startListening()
    }
  }

  // 显示错误信息或状态文案
  const tooltipText = () => {
    if (voice.error()) return voice.error()!
    if (voice.isListening()) return props.t("voice.stop")
    return props.t("voice.start")
  }

  return (
    <Tooltip placement="top" value={tooltipText()}>
      <IconButton
        icon={voice.isListening() ? "mic-recording" : "mic"}
        variant={voice.isListening() ? "primary" : "secondary"}
        size="small"
        onClick={handleClick}
        aria-label={tooltipText()}
        class={voice.isListening() || voice.error() ? "animate-pulse!" : ""}
      />
    </Tooltip>
  )
}
