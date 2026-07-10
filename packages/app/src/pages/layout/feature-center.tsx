import { useLanguage } from "@/context/language"
import { FeatureCard } from "@/components/feature-center/feature-card"
import { VoicePanel } from "@/pages/feature-center/voice-panel"
import { PluginPanel } from "@/pages/feature-center/plugin-panel"

export const FeatureCenterPanel = () => {
  const language = useLanguage()
  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="px-4 py-3 text-14-medium text-text-strong border-b border-border-weak-base">
        {language.t("featureCenter.title")}
      </div>
      <div class="flex-1 py-2 space-y-1">
        <FeatureCard
          icon="🎤"
          title={language.t("featureCenter.voice")}
          description={language.t("featureCenter.voice.description")}
        >
          <VoicePanel />
        </FeatureCard>
        <FeatureCard
          icon="🔌"
          title={language.t("featureCenter.plugins")}
          description={language.t("featureCenter.plugins.description")}
        >
          <PluginPanel />
        </FeatureCard>
      </div>
    </div>
  )
}
