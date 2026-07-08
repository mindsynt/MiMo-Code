/**
 * Rule extractor — identifies project-level rules, conventions, and decisions
 * from conversation text using deterministic pattern matching (no LLM call).
 *
 * Each extracted rule is a structured fact that gets stored as a "rule" entity
 * in the entity-relation graph with provenance tracking.
 */

export type ExtractedRule = {
  /** Slug derived from rule text for dedup (e.g. "drizzle_snake_case") */
  slug: string
  /** Human-readable rule statement */
  text: string
  /** Confidence 0-1 */
  confidence: number
  /** Category of the rule for classification */
  category: "convention" | "decision" | "constraint" | "preference"
  /** Names of entities (files, concepts, APIs) this rule governs — extracted
   *  from the original conversation text alongside the rule statement.
   *  Used to link the rule to specific code entities via `governs` relations. */
  governs: string[]
}

// ── Chinese patterns ────────────────────────────────────────────────────────

// 规范声明: "规则是XXX", "规范是XXX", "约定是XXX"
const RULE_IS = /(?:规则|规范|约定)(?:是|：|:)\s*(.+)/

// 行为约束: "必须用XXX", "永远不要用XXX", "不要用XXX", "禁止XXX"
const MUST = /(?:必须|要)\s*(?:使用|用)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)/

const NEVER = /(?:永远不要|千万别|不能|禁止)\s*(?:使用|用|)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)?/

const SHOULD_NOT = /(?:不要用|别用|避免使用|少用|不应)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)?/

// 决策记录: "决定用XXX而不是YYY", "采用XXX方案"
const DECISION =
  /(?:决定|选用|采用)(?:使用|用|)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)?(?:\s*(?:而不是|而非|不用)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)?)?/

// 架构原则: "优先考虑XXX", "尽量用XXX", "推荐用XXX"
const PREFER = /(?:优先考虑|优先使用|尽量用|尽量使用|推荐用|推荐使用)\s*(?:[\`]?)([\w.\-\/]+)(?:[\`]?)?/

// ── English patterns ─────────────────────────────────────────────────────────

const RULE_COLON = /^(?:Rule|Convention|Note|Policy)[:]\s*(.+)/im

const ALWAYS_NEVER = /^(Always|Never)\s+(.+)/im

const MUST_EN = /(must|should)\s+(?:use|be|follow|set|keep)\s+(.+)/i

// Slug generation: removes quotes, backticks, special chars
function toSlug(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80)
  return normalized || "rule"
}

function toCategory(text: string): ExtractedRule["category"] {
  if (/决定|选用|采用|而不是|而非|decision/i.test(text)) return "decision"
  if (/必须|禁止|永远不要|never|must|always/i.test(text)) return "constraint"
  if (/优先|推荐|尽量|prefer|recommend/i.test(text)) return "preference"
  return "convention"
}

/**
 * Extracts file and concept names from the conversation text around a rule.
 *
 * Scans the entire turn text for:
 * - Backtick file paths: `session.sql`, `src/main.ts`
 * - CamelCase identifiers: DependencyInjection, EventBus
 * - import paths: from "lodash"
 *
 * These are used to link the rule to relevant graph entities via `governs`
 * relations, enabling file-scoped rule queries.
 */
export function extractGovernedEntities(text: string): string[] {
  const found = new Set<string>()

  // Backtick file paths: `session.sql`, `src/main.ts`, `./components/Button.tsx`
  const filePattern = /`([^`]+\.(?:ts|js|tsx|jsx|json|md|css|scss|html|py|rs|go|java|kt|sql|yaml|yml|toml))`/g
  for (const match of text.matchAll(filePattern)) {
    // Normalize: strip leading `./` and `../` for consistent matching
    const normalized = match[1].replace(/^(?:\.\.\/)+|^\.\//g, "")
    found.add(normalized)
  }

  // Backtick plain identifiers: `session`, `authMiddleware`, `UserService`
  const idPattern = /`([\w.]+)`/g
  for (const match of text.matchAll(idPattern)) {
    const name = match[1]
    if (name.includes(".") || name === "") continue
    if (/^\d/.test(name)) continue
    found.add(name)
  }

  // CamelCase concepts mentioned alongside the rule
  const camelPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g
  for (const match of text.matchAll(camelPattern)) {
    found.add(match[1])
  }

  // import from packages
  const importPattern = /from\s+["']([^"']+)["']/g
  for (const match of text.matchAll(importPattern)) {
    const pkg = match[1]
    if (pkg.startsWith(".") || pkg.startsWith("@")) continue
    found.add(pkg)
  }

  return Array.from(found)
}

/**
 * Extracts project rules from a single turn of conversation text.
 *
 * Returns an empty array when no rules are found. Pure function —
 * no side effects.
 */
export function extractRules(text: string): ExtractedRule[] {
  const results: ExtractedRule[] = []
  const seen = new Set<string>()

  function add(ruleText: string, baseConfidence: number) {
    const slug = toSlug(ruleText)
    if (seen.has(slug)) return
    seen.add(slug)
    results.push({
      slug,
      text: ruleText.trim(),
      confidence: baseConfidence,
      category: toCategory(ruleText),
      governs: extractGovernedEntities(text),
    })
  }

  // Chinese patterns
  const m1 = text.match(RULE_IS)
  if (m1) add(m1[1], 0.9)

  const m2 = text.match(MUST)
  if (m2) add(`必须使用 ${m2[1]}`, 0.8)

  const m3 = text.match(NEVER)
  if (m3) add(`禁止使用 ${m3[1]}`, 0.85)

  const m4 = text.match(SHOULD_NOT)
  if (m4) add(`避免使用 ${m4[1]}`, 0.7)

  const m5 = text.match(DECISION)
  if (m5) {
    const chosen = m5[1]
    const rejected = m5[2]
    if (rejected) add(`选用 ${chosen} 而不是 ${rejected}`, 0.9)
    else add(`选用 ${chosen}`, 0.7)
  }

  const m6 = text.match(PREFER)
  if (m6) add(`优先使用 ${m6[1]}`, 0.6)

  // English patterns
  const m7 = text.match(RULE_COLON)
  if (m7) add(m7[1], 0.9)

  const m8 = text.match(ALWAYS_NEVER)
  if (m8) add(`${m8[1]} ${m8[2]}`, 0.8)

  const m9 = text.match(MUST_EN)
  if (m9) add(`${m9[1]} ${m9[2]}`, 0.7)

  return results
}
