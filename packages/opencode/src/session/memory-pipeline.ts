import { spawnRef } from "@/actor/spawn-ref"
import {
  callLLMForRelations,
  buildRelationPrompt,
  parseRelationLLMOutput,
  setCallLLMForRelations,
} from "@/memory/extractors/relations"
import { classifyPersistence, type ExtractedEntity } from "@/memory/classification"
import { extractCodeEntities } from "@/memory/extractors/code"
import { extractConcepts } from "@/memory/extractors/concept"
import { upsertEntity, upsertRelation, boostEntityConfidence } from "@/memory/entities"
import { Effect } from "effect"
import { Deferred } from "effect"
import type { SessionID } from "./schema"

/**
 * Two-phase memory pipeline:
 *
 * **Phase A (sync):** Classifies the message persistence tier, extracts code and concept
 * entities, and upserts them to the entity store. Returns early for discard/short_term
 * messages with no entities.
 *
 * **Phase B (async):** Builds a relation-extraction prompt from the extracted entities,
 * calls the LLM via spawnRef subagent, parses the response, and upserts relations with
 * confidence boosts.
 */
export async function runMemoryPipeline(input: {
  sessionID: SessionID
  text: string
  messageID: string
}): Promise<void> {
  // ── Phase A: Classification ──────────────────────────────────────────────────
  const tier = classifyPersistence(input.text)
  if (tier === "discard") return

  // ── Phase A: Entity extraction ────────────────────────────────────────────────
  const codeEntities = extractCodeEntities(input.text)
  const excludeNames = new Set(codeEntities.map((e) => e.name))
  const conceptEntities = extractConcepts(input.text, excludeNames)
  const entities: ExtractedEntity[] = [...codeEntities, ...conceptEntities]

  // short_term messages with no entities → nothing to persist
  if (entities.length === 0 && tier === "short_term") return

  // ── Phase A: Upsert entities ──────────────────────────────────────────────────
  for (const entity of entities) {
    upsertEntity({
      name: entity.name,
      type: entity.type,
      context: entity.context,
      confidence: entity.confidence,
      source: "conversation",
      tier,
    })
  }

  // ── Phase B: Relation extraction (only with entities) ─────────────────────────
  if (entities.length === 0) return

  // Configure the LLM callback to use spawnRef when the Actor layer is available.
  // When spawnRef is not set (e.g., test environment), the existing callLLMForRelations
  // (set via setCallLLMForRelations by the caller) is preserved so test mocks work.
  if (spawnRef.current) {
    setCallLLMForRelations(async (prompt: string) => {
      const actor = spawnRef.current!
      const spawnResult = await Effect.runPromise(
        actor.spawn({
          mode: "subagent",
          sessionID: input.sessionID,
          agentType: "general",
          task: prompt,
          context: "none",
          tools: [],
          background: false,
        }),
      )
      const outcome = await Effect.runPromise(Deferred.await(spawnResult.outcome))
      if (outcome.status === "success") return outcome.finalText ?? ""
      return ""
    })
  }

  const candidates = entities.map((e) => ({ name: e.name, type: e.type }))
  const prompt = buildRelationPrompt(input.text, candidates)

  // Phase B failures are non-fatal: entities from Phase A have already been persisted.
  try {
    const raw = await callLLMForRelations(prompt)
    const relations = parseRelationLLMOutput(raw)

    for (const rel of relations) {
      upsertRelation({
        source: rel.source,
        target: rel.target,
        type: rel.type,
        weight: rel.confidence,
      })
      boostEntityConfidence(rel.source, rel.confidence * 0.05)
      boostEntityConfidence(rel.target, rel.confidence * 0.05)
    }
  } catch {
    // Phase B failure is non-fatal
  }
}
