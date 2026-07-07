import type { ExtractedEntity } from "../classification"

/**
 * Extract conceptual entities from text using regex patterns.
 *
 * Patterns:
 * - "A策略/模式/架构/机制/方案" → type: "concept", confidence: 0.5
 * - 驼峰概念: CamelCaseIdentifiers → type: "concept", confidence: 0.4
 * - X化: 模块化/标准化/自动化 → type: "concept", confidence: 0.4
 *
 * @param text - Input text to extract concepts from.
 * @param excludeNames - Optional set of names to exclude (e.g. from extractCodeEntities), for cross-extractor dedup.
 */
export function extractConcepts(text: string, excludeNames?: Set<string>): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>()

  function add(name: string, type: string, confidence: number) {
    if (excludeNames?.has(name)) return
    const existing = seen.get(name)
    if (!existing || existing.confidence < confidence) {
      seen.set(name, { name, type, confidence })
    }
  }

  // 1. "A 策略/模式/架构/机制/方案" — concept naming pattern
  // e.g. "缓存策略", "微服务架构", "补偿机制", "最优方案"
  // Prefix limited to max 4 chars to avoid consuming preceding verbs
  const conceptPattern = /([\u4e00-\u9fff]{1,4}(?:策略|模式|架构|机制|方案))/g
  for (const match of text.matchAll(conceptPattern)) {
    add(match[1], "concept", 0.5)
  }

  // 2. 驼峰概念 — CamelCase identifiers (non-code context)
  // e.g. "TypeScript", "VueRouter", "DependencyInjection"
  const camelPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g
  for (const match of text.matchAll(camelPattern)) {
    add(match[1], "concept", 0.4)
  }

  // 3. X化 — Chinese suffix 化 (hua, "-ification")
  // e.g. "模块化", "标准化", "自动化", "容器化"
  // Prefix limited to max 3 chars to avoid consuming preceding verbs
  const huaPattern = /([\u4e00-\u9fff]{1,3}化)/g
  for (const match of text.matchAll(huaPattern)) {
    add(match[1], "concept", 0.4)
  }

  return Array.from(seen.values())
}
