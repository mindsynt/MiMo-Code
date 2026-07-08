import { listPreferences, upsertPreference } from "./profile"
import { Log } from "../util"
import PROMPT_REFLECTION from "./reflection-writer.txt"

const log = Log.create({ service: "memory.reflection" })

export async function runReflection(): Promise<void> {
  const preferences = listPreferences()
  const preferenceSummary = preferences
    .map((p) => `  - ${p.key} = ${p.value} (${p.category}, conf=${p.confidence.toFixed(2)})`)
    .join("\n")

  const prompt = [PROMPT_REFLECTION, "", "## Current preferences", preferenceSummary || "  (none)"].join("\n")

  log.info("reflection prompt built", { preferenceCount: preferences.length })

  // For Phase 3 MVP, the reflection agent is a placeholder that just logs.
  // Full LLM-driven reflection requires actor.spawn integration (future work).
  // For now, we demote low-confidence inferred patterns.
  const { decayLowConfidencePreferences } = await import("./profile")
  const pruned = decayLowConfidencePreferences()
  if (pruned > 0) {
    log.info("reflection: demoted low-confidence patterns", { pruned })
  }

  log.info("reflection completed")
}
