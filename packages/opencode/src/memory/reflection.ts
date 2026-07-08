import { listPreferences, upsertPreference, promotePreference, decayAndPrune, type ProfileEntry } from "./profile"
import { queryRules } from "./rules"
import { Log } from "../util"
import PROMPT_REFLECTION from "./reflection-writer.txt"

const log = Log.create({ service: "memory.reflection" })

// Track consecutive failures to avoid hammering the LLM
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * Run periodic reflection:
 * 1. Decay + prune old preferences (tier-aware, always runs — no LLM)
 * 2. If an LLM actor is available, analyze accumulated preferences
 *    to infer deeper patterns and promote high-confidence ones.
 * 3. If actor unavailable, fall back to heuristic-based promotion.
 */
export async function runReflection(): Promise<void> {
  // ── Phase 1: Always run decay + prune (no LLM needed) ─────────────────
  const { demoted, pruned } = decayAndPrune()
  if (demoted > 0 || pruned > 0) {
    log.info("reflection: decay & prune", { demoted, pruned })
  }

  // ── Phase 2: LLM-driven reflection (skip after consecutive failures) ──
  const preferences = listPreferences()
  if (preferences.length === 0) {
    log.info("reflection: no preferences to analyze")
    return
  }

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    log.warn("reflection: too many consecutive failures, skipping LLM phase")
    // Fall through to heuristic promotion
  } else {
    try {
      const success = await runLLMReflection(preferences)
      if (success) {
        consecutiveFailures = 0
        return // LLM succeeded, skip heuristic fallback
      }
    } catch (err) {
      log.warn("reflection: LLM phase failed", { err })
    }
    consecutiveFailures++
  }

  // ── Phase 3: Heuristic fallback (no LLM) ──────────────────────────────
  runHeuristicReflection(preferences)
}

/**
 * LLM-driven reflection: spawn a subagent to analyze preferences and
 * identify deeper patterns / contradictions / promotion opportunities.
 */
async function runLLMReflection(preferences: ProfileEntry[]): Promise<boolean> {
  // Build a compact summary of current preferences
  const lines = preferences.map(
    (p) => `  - ${p.key} = ${p.value} (${p.category}, tier=${p.tier}, conf=${p.confidence.toFixed(2)})`,
  )
  const summary = lines.join("\n")
  const prompt = [PROMPT_REFLECTION, "", "## Current preferences", summary].join("\n")

  // Try to use actor.spawn via spawnRef (set by memory-pipeline on init).
  // When spawnRef isn't available, fall through to heuristic.
  const { spawnRef } = await import("@/actor/spawn-ref")
  const ref = spawnRef.current
  if (!ref) return false

  const { Effect, Deferred } = await import("effect")

  const spawnResult = await Effect.runPromise(
    ref.spawn({
      mode: "subagent",
      sessionID: "reflection" as any,
      agentType: "general",
      task: prompt,
      context: "none",
      tools: [],
      background: false,
    }),
  )
  const outcome = await Effect.runPromise(Deferred.await(spawnResult.outcome))
  if (outcome.status !== "success" || !outcome.finalText) return false

  // Parse LLM output
  const result = parseReflectionOutput(outcome.finalText)
  if (!result) return false

  // Apply promotions
  for (const p of result.promotions) {
    upsertPreference({
      key: p.key,
      value: p.value,
      category: "explicit_preference",
      confidence: p.confidence,
      source: "reflection",
      tier: "ephemeral", // upsertPreference will promote based on confidence
    })
  }

  // Apply new inferred patterns
  for (const np of result.newPreferences) {
    upsertPreference({
      key: np.key,
      value: np.value,
      category: "inferred_pattern",
      confidence: np.confidence,
      source: "reflection",
      tier: "ephemeral",
    })
  }

  // Apply tier promotions (confidence-based promotion already happens in
  // upsertPreference, but reflection may explicitly upgrade core items)
  if (result.promotions.length > 0 || result.newPreferences.length > 0) {
    log.info("reflection: LLM applied updates", {
      promotions: result.promotions.length,
      newPatterns: result.newPreferences.length,
    })
  }

  return true
}

type ReflectionOutput = {
  promotions: Array<{ key: string; value: string; confidence: number; evidence: string }>
  newPreferences: Array<{ key: string; value: string; confidence: number }>
  memoryUpdates: Array<{ section: string; content: string }>
}

function parseReflectionOutput(raw: string): ReflectionOutput | null {
  let jsonStr = raw.trim()
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlockMatch) jsonStr = jsonBlockMatch[1].trim()

  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== "object") return null
    return {
      promotions: Array.isArray(parsed.promotions) ? parsed.promotions : [],
      newPreferences: Array.isArray(parsed.newPreferences) ? parsed.newPreferences : [],
      memoryUpdates: Array.isArray(parsed.memoryUpdates) ? parsed.memoryUpdates : [],
    }
  } catch {
    return null
  }
}

/**
 * Heuristic fallback: promote preferences based on confidence thresholds,
 * no LLM call needed.
 */
function runHeuristicReflection(preferences: ProfileEntry[]) {
  let promoted = 0
  let newPatterns = 0

  for (const p of preferences) {
    // Promote explicit_preferences with high confidence to core
    if (p.category === "explicit_preference" && p.confidence >= 0.8 && p.tier !== "core") {
      promotePreference(p.key, "core")
      promoted++
    }
    // Promote inferred patterns with strong signal to explicit
    if (p.category === "inferred_pattern" && p.confidence >= 0.7 && p.tier !== "stable") {
      promotePreference(p.key, "stable")
      promoted++
    }
  }

  if (promoted > 0 || newPatterns > 0) {
    log.info("reflection: heuristic updates", { promoted, newPatterns })
  }
}
