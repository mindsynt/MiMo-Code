import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"

type FeatureCenterTab = "projects" | "features"

interface FeatureCenterContextValue {
  activeTab: Accessor<FeatureCenterTab>
  setActiveTab: (tab: FeatureCenterTab) => void
}

const FeatureCenterContext = createContext<FeatureCenterContextValue>()

export function FeatureCenterProvider(props: ParentProps) {
  const [activeTab, setActiveTab] = createSignal<FeatureCenterTab>("projects")

  return (
    <FeatureCenterContext.Provider value={{ activeTab, setActiveTab }}>{props.children}</FeatureCenterContext.Provider>
  )
}

export function useFeatureCenter() {
  const context = useContext(FeatureCenterContext)
  if (!context) throw new Error("useFeatureCenter must be used within FeatureCenterProvider")
  return context
}
