import { Collapsible } from "@mimo-ai/ui/collapsible"
import { createSignal, type JSX } from "solid-js"

interface FeatureCardProps {
  icon: string
  title: string
  description: string
  children: JSX.Element
  defaultOpen?: boolean
}

export function FeatureCard(props: FeatureCardProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)

  return (
    <Collapsible open={open()} onOpenChange={setOpen}>
      <button
        type="button"
        class="flex items-center gap-2 w-full px-3 py-2 text-14-medium text-text-strong hover:bg-surface-base-hover rounded-md"
        onClick={() => setOpen(!open())}
      >
        <span>{props.icon}</span>
        <span class="flex-1 text-left">{props.title}</span>
        <span class="text-12-regular text-text-weak truncate max-w-[120px]">{props.description}</span>
      </button>
      <Collapsible.Content class="px-3 py-2">{props.children}</Collapsible.Content>
    </Collapsible>
  )
}
