import type { ExtractedEntity } from "../classification"

/**
 * Extract code-related entities from text using regex patterns.
 *
 * Patterns:
 * - 反引号函数调用: `fn(...)` → type: "function"
 * - import from 包: from "pkg" → type: "package"
 * - 配置常量: ALL_CAPS = number → type: "config"
 * - 文件引用: `path.ext` → type: "file"
 * - interface/type/class 声明 → type: "concept"
 */
export function extractCodeEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  function add(name: string, type: string, confidence: number) {
    if (!seen.has(name)) {
      seen.add(name)
      entities.push({ name, type, confidence })
    }
  }

  // 1. 反引号函数调用: `Bun.write()`, `fs.readFileSync(path)`
  const fnPattern = /`([\w.]+)\([^)]*\)`/g
  for (const match of text.matchAll(fnPattern)) {
    add(match[1], "function", 0.9)
  }

  // 2. import from 包: from "lodash", from 'react'
  const importPattern = /from\s+["']([^"']+)["']/g
  for (const match of text.matchAll(importPattern)) {
    add(match[1], "package", 0.8)
  }

  // 3. 配置常量: MAX_RETRIES = 5, API_TIMEOUT = 3000
  const configPattern = /\b([A-Z][A-Z_]{2,})\s*=\s*\d+/g
  for (const match of text.matchAll(configPattern)) {
    add(match[1], "config", 0.7)
  }

  // 4. 文件引用: `src/index.ts`, `./components/Button.tsx`
  const filePattern = /`([^`]+\.(?:ts|js|tsx|jsx|json|md))`/g
  for (const match of text.matchAll(filePattern)) {
    add(match[1], "file", 0.8)
  }

  // 5. interface/type/class 声明
  const declPattern = /(interface|type|class)\s+(\w+)/g
  for (const match of text.matchAll(declPattern)) {
    add(match[2], "concept", 0.7)
  }

  return entities
}
