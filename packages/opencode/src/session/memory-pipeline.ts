import { spawnRef } from "@/actor/spawn-ref"
import {
  callLLMForRelations,
  buildRelationPrompt,
  parseRelationLLMOutput,
  setCallLLMForRelations,
} from "@/memory/extractors/relations"
import { extractRules } from "@/memory/extractors/rules"
import { classifyPersistence, classifyPersonal, type ExtractedEntity } from "@/memory/classification"
import { extractCodeEntities } from "@/memory/extractors/code"
import { extractConcepts } from "@/memory/extractors/concept"
import { upsertEntity, upsertRelation, boostEntityConfidence } from "@/memory/entities"
import { upsertRule, linkRuleToEntity } from "@/memory/rules"
import { upsertPreference } from "@/memory/profile"
import { ChunkTable } from "@/memory/vectors.sql"
import { Database, eq } from "@/storage"
import { Log } from "@/util"
import { cleanupExpired } from "../memory/cleanup"
import { Effect } from "effect"
import { Deferred } from "effect"
import type { SessionID } from "./schema"

const log = Log.create({ service: "memory-pipeline" })

let pipelineRunCount = 0

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
interface Chunk {
  text: string
}

// Mixed chunking strategy:
// 1. Entity-based: split by sentence, keep sentences containing entity names
// 2. Sliding window: for long text > 500 chars, 256-char windows with 128 stride
// 3. Fallback: first 512 chars if no chunks produced
export function chunkText(text: string, entityNames: string[]): Chunk[] {
  const chunks: Chunk[] = []
  const seen = new Set<string>()

  // Entity-based chunks
  const sentences = text.split(/[。！？\n\r]+/).filter(Boolean)
  for (const s of sentences) {
    const trimmed = s.trim()
    if (!trimmed) continue
    const hasEntity = entityNames.length === 0 || entityNames.some((n) => trimmed.includes(n))
    if (hasEntity && !seen.has(trimmed)) {
      seen.add(trimmed)
      chunks.push({ text: trimmed.length > 512 ? trimmed.slice(0, 512) : trimmed })
    }
  }

  // Sliding window for long text
  if (text.length > 500) {
    const windowSize = 256
    const stride = 128
    for (let i = 0; i < text.length - windowSize; i += stride) {
      const window = text.slice(i, i + windowSize)
      if (!seen.has(window)) {
        seen.add(window)
        chunks.push({ text: window })
      }
    }
  }

  // Fallback: first 512 chars
  if (chunks.length === 0) {
    chunks.push({ text: text.slice(0, 512) })
  }

  return chunks
}

export async function runMemoryPipeline(input: {
  sessionID: SessionID
  text: string
  messageID: string
}): Promise<void> {
  const start = performance.now()

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

  // ── Periodic cleanup ────────────────────────────────────────────────────────────
  pipelineRunCount++
  if (pipelineRunCount % 50 === 0) {
    try {
      const result = cleanupExpired()
      if (result.expiredChunks > 0 || result.expiredVectors > 0) {
        log.info("periodic cleanup", result)
      }
    } catch (err) {
      log.warn("periodic cleanup failed", { err })
    }
  }

  // ── Phase 2: Chunk + embed (async, non-blocking) ─────────────────────────────
  if (entities.length > 0) {
    const entityNames = entities.map((e) => e.name)
    const chunks = chunkText(input.text, entityNames)
    const createdChunkIds: number[] = []

    const now = Date.now()
    for (const chunk of chunks) {
      const result = Database.use((db) =>
        db
          .insert(ChunkTable)
          .values({
            chunk_text: chunk.text,
            source: "conversation",
            tier: tier === "persistent" ? "persistent" : "short_term",
            ttl: tier === "persistent" ? null : now + 7 * 86400_000,
            created_at: now,
          })
          .returning({ id: ChunkTable.id })
          .get(),
      )
      if (result) createdChunkIds.push(result.id)
    }

    if (createdChunkIds.length > 0) {
      Promise.all(
        createdChunkIds.map(async (chunkId) => {
          try {
            const row = Database.use((db) =>
              db.select({ text: ChunkTable.chunk_text }).from(ChunkTable).where(eq(ChunkTable.id, chunkId)).get(),
            )
            if (!row) return
            const { generateEmbedding, getVectorIndex } = await import("../memory/vectors")
            const embedding = await generateEmbedding(row.text)
            getVectorIndex().add(chunkId, embedding, row.text)
          } catch (err) {
            log.warn("embedding failed", { chunkId, err })
          }
        }),
      ).catch((err) => log.warn("Phase 2 vector pipeline failed", { err }))
    }
  }

  // ── Profile extraction ────────────────────────────────────────────────────────
  const prefs = classifyPersonal(input.text)
  for (const p of prefs) {
    upsertPreference({
      key: p.key,
      value: p.value,
      category: "explicit_preference",
      confidence: p.confidence,
      source: "conversation",
      tier: "ephemeral",
    })
  }

  // ── Phase C: Rule extraction ──────────────────────────────────────────────────
  // Pattern-based, no LLM call — deterministic, zero hallucination.
  const rules = extractRules(input.text)
  for (const rule of rules) {
    upsertRule({
      slug: rule.slug,
      text: rule.text,
      confidence: rule.confidence,
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
    // Link rule to entities it governs (files, concepts, APIs mentioned
    // in the same conversation turn). Only creates relations when both
    // the rule and the target entity already exist in the graph.
    for (const governedName of rule.governs) {
      linkRuleToEntity(rule.slug, governedName)
    }
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

  const totalMs = Math.round(performance.now() - start)
  if (totalMs > 1000) {
    log.warn("memory pipeline exceeded 1s budget", { totalMs, sessionID: input.sessionID })
  }
}
