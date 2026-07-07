import { upsertRelation, boostEntityConfidence } from "../entities"

export type ExtractedRelation = {
  source: string
  target: string
  type: "depends_on" | "implements" | "configures" | "calls" | "prefers" | "part_of" | "similar_to" | "rejects"
  confidence: number
}

const RELATION_TYPES = [
  "depends_on",
  "implements",
  "configures",
  "calls",
  "prefers",
  "part_of",
  "similar_to",
  "rejects",
] as const

export let callLLMForRelations: (prompt: string) => Promise<string> = async () => {
  throw new Error("callLLMForRelations not configured — Task 5 pipeline must set this")
}

/** Set the LLM calling function. Use this from tests and the pipeline (Task 5). */
export function setCallLLMForRelations(fn: (prompt: string) => Promise<string>) {
  callLLMForRelations = fn
}

export function buildRelationPrompt(text: string, candidates: { name: string; type: string }[]): string {
  const truncated = text.length > 4000 ? text.slice(0, 4000) : text
  const entityLines = candidates.map((c) => `  - ${c.name} (${c.type})`).join("\n")

  return `You are a relation extractor. Given the text and candidate entities below, identify all relations between the entities.

Available relation types:
${RELATION_TYPES.map((t) => `  - ${t}`).join("\n")}

Candidate entities:
${entityLines}

Text to analyze:
"""
${truncated}
"""

Return a JSON array of objects. Each object must have:
  - "source": string (entity name from candidates)
  - "target": string (entity name from candidates)
  - "type": one of the relation types above
  - "confidence": number between 0 and 1

Only include relations that are clearly supported by the text. Return [] if no relations are found.

Respond with valid JSON only, no explanations.`
}

export function parseRelationLLMOutput(raw: string): ExtractedRelation[] {
  // Strip markdown code block fences if present
  let jsonStr = raw.trim()
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed.filter((item): item is ExtractedRelation => {
    if (!item || typeof item !== "object") return false
    const r = item as Record<string, unknown>
    if (typeof r.source !== "string" || !r.source) return false
    if (typeof r.target !== "string" || !r.target) return false
    if (typeof r.type !== "string") return false
    if (!(RELATION_TYPES as readonly string[]).includes(r.type)) return false
    if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) return false
    return true
  })
}

export async function refineRelationsWithLLM(
  text: string,
  candidates: { name: string; type: string }[],
  _sessionID: string,
): Promise<void> {
  if (candidates.length < 2) return

  const prompt = buildRelationPrompt(text, candidates)
  const raw = await callLLMForRelations(prompt)
  const relations = parseRelationLLMOutput(raw)

  for (const rel of relations) {
    upsertRelation({ source: rel.source, target: rel.target, type: rel.type, weight: rel.confidence })
    boostEntityConfidence(rel.source, rel.confidence * 0.05)
    boostEntityConfidence(rel.target, rel.confidence * 0.05)
  }
}
