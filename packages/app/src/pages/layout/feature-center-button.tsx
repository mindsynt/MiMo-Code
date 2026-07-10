import { IconButton } from "@mimo-ai/ui/icon-button"
import { Tooltip } from "@mimo-ai/ui/tooltip"

export const FeatureCenterButton = (props: {
  active: boolean
  onClick: () => void
  label: string
  placement?: "right" | "bottom"
}) => (
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
