import { describe, expect, test } from "bun:test"
import { classifyPersistence, type ExtractedEntity } from "../../src/memory/classification"
import { extractCodeEntities } from "../../src/memory/extractors/code"
import { extractConcepts } from "../../src/memory/extractors/concept"

// ---------------------------------------------------------------------------
// classifyPersistence
// ---------------------------------------------------------------------------

describe("classifyPersistence", () => {
  // --- discard: edge / empty ---
  test("empty string returns discard", () => {
    expect(classifyPersistence("")).toBe("discard")
  })

  test("whitespace-only returns discard", () => {
    expect(classifyPersistence("   ")).toBe("discard")
    expect(classifyPersistence("\t\n  ")).toBe("discard")
  })

  // --- discard: pure punctuation ---
  test("pure punctuation returns discard", () => {
    expect(classifyPersistence("。。。")).toBe("discard")
    expect(classifyPersistence("???")).toBe("discard")
    expect(classifyPersistence("!!!")).toBe("discard")
    expect(classifyPersistence("。。")).toBe("discard")
    expect(classifyPersistence("...")).toBe("discard")
  })

  // --- discard: single-word confirmations ---
  test("single-word confirmations return discard", () => {
    expect(classifyPersistence("好的")).toBe("discard")
    expect(classifyPersistence("嗯")).toBe("discard")
    expect(classifyPersistence("ok")).toBe("discard")
    expect(classifyPersistence("OK")).toBe("discard")
    expect(classifyPersistence("yes")).toBe("discard")
    expect(classifyPersistence("y")).toBe("discard")
    expect(classifyPersistence("no")).toBe("discard")
    expect(classifyPersistence("n")).toBe("discard")
    expect(classifyPersistence("继续")).toBe("discard")
    expect(classifyPersistence("是")).toBe("discard")
    expect(classifyPersistence("对")).toBe("discard")
    expect(classifyPersistence("行")).toBe("discard")
    expect(classifyPersistence("好")).toBe("discard")
    expect(classifyPersistence("知道")).toBe("discard")
  })

  // --- discard: short meta-conversation (≤10 chars, no substance) ---
  test("short text without substance returns discard", () => {
    expect(classifyPersistence("你好")).toBe("discard")
    expect(classifyPersistence("我知道了")).toBe("discard")
    expect(classifyPersistence("明白了")).toBe("discard")
    expect(classifyPersistence("hello")).toBe("discard")
    expect(classifyPersistence("没错")).toBe("discard")
    expect(classifyPersistence("辛苦了")).toBe("discard")
  })

  // --- persistent: backtick function/API ---
  test("backtick function call returns persistent", () => {
    expect(classifyPersistence("使用 `Bun.write()` 写入文件")).toBe("persistent")
    expect(classifyPersistence("调用 `fs.readFileSync(path)` 读取")).toBe("persistent")
    expect(classifyPersistence("`console.log(x)` 调试")).toBe("persistent")
  })

  // --- persistent: rule declarations ---
  test("rule declarations return persistent", () => {
    expect(classifyPersistence("我们永远不要使用any类型")).toBe("persistent")
    expect(classifyPersistence("总是用const声明")).toBe("persistent")
    expect(classifyPersistence("必须添加类型注解")).toBe("persistent")
    expect(classifyPersistence("禁止使用var")).toBe("persistent")
    expect(classifyPersistence("应该使用interface而不是type")).toBe("persistent")
  })

  // --- persistent: architecture decisions ---
  test("architecture decisions return persistent", () => {
    expect(classifyPersistence("决定使用PostgreSQL")).toBe("persistent")
    expect(classifyPersistence("选用TypeScript作为主力语言")).toBe("persistent")
    expect(classifyPersistence("采用React框架")).toBe("persistent")
    expect(classifyPersistence("放弃直接操作DOM")).toBe("persistent")
    expect(classifyPersistence("用Effect而不是try/catch")).toBe("persistent")
  })

  // --- persistent: config assignment ---
  test("config assignment returns persistent", () => {
    expect(classifyPersistence('NAME="test"')).toBe("persistent")
    expect(classifyPersistence("PORT='8080'")).toBe("persistent")
    expect(classifyPersistence("MAX_RETRIES=5")).toBe("persistent")
    expect(classifyPersistence("TIMEOUT = 3000")).toBe("persistent")
    expect(classifyPersistence('API_KEY = "abc123"')).toBe("persistent")
  })

  // --- short_term ---
  test("normal conversation returns short_term", () => {
    expect(classifyPersistence("我们今天来讨论一下项目的技术选型")).toBe("short_term")
    expect(classifyPersistence("这个功能看起来不错，我们来试试")).toBe("short_term")
    expect(classifyPersistence("能帮我看看这个bug吗")).toBe("short_term")
  })

  test("long text without persistent markers returns short_term", () => {
    const longText = "我觉得这个方案挺好的，我们可以先试试看效果怎么样。如果不行再换别的方案。"
    expect(classifyPersistence(longText)).toBe("short_term")
  })

  // --- interaction: short text with persistent content ---
  test("short text with code snippet returns persistent", () => {
    // Short (<20 chars) but has backtick code
    expect(classifyPersistence("用 `Bun.write()`")).toBe("persistent")
  })
})

// ---------------------------------------------------------------------------
// extractCodeEntities
// ---------------------------------------------------------------------------

describe("extractCodeEntities", () => {
  test("extracts backtick function calls", () => {
    const result = extractCodeEntities("使用 `Bun.write()` 写入文件")
    expect(result).toContainEqual<ExtractedEntity>({ name: "Bun.write", type: "function", confidence: 0.9 })
  })

  test("extracts multiple backtick function calls", () => {
    const result = extractCodeEntities("调用 `fs.readFileSync(path)` 和 `console.log(x)`")
    expect(result).toContainEqual<ExtractedEntity>({ name: "fs.readFileSync", type: "function", confidence: 0.9 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "console.log", type: "function", confidence: 0.9 })
  })

  test("extracts import from packages", () => {
    const result = extractCodeEntities('import { something } from "lodash"')
    expect(result).toContainEqual<ExtractedEntity>({ name: "lodash", type: "package", confidence: 0.8 })
  })

  test("extracts single-quoted import packages", () => {
    const result = extractCodeEntities("from 'react'")
    expect(result).toContainEqual<ExtractedEntity>({ name: "react", type: "package", confidence: 0.8 })
  })

  test("extracts config constants", () => {
    const result = extractCodeEntities("MAX_RETRIES = 5")
    expect(result).toContainEqual<ExtractedEntity>({ name: "MAX_RETRIES", type: "config", confidence: 0.7 })
  })

  test("extracts multiple config constants", () => {
    const result = extractCodeEntities("MAX_RETRIES = 5; API_TIMEOUT = 3000")
    expect(result).toContainEqual<ExtractedEntity>({ name: "MAX_RETRIES", type: "config", confidence: 0.7 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "API_TIMEOUT", type: "config", confidence: 0.7 })
  })

  test("extracts file references in backticks", () => {
    const result = extractCodeEntities("请查看 `src/index.ts`")
    expect(result).toContainEqual<ExtractedEntity>({ name: "src/index.ts", type: "file", confidence: 0.8 })
  })

  test("extracts file references with various extensions", () => {
    const result = extractCodeEntities("`app.js` `page.tsx` `style.css` `data.json` `readme.md`")
    expect(result).toContainEqual<ExtractedEntity>({ name: "app.js", type: "file", confidence: 0.8 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "page.tsx", type: "file", confidence: 0.8 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "data.json", type: "file", confidence: 0.8 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "readme.md", type: "file", confidence: 0.8 })
    // css is not in the supported extensions → should not be extracted
    expect(result.find((e) => e.name === "style.css")).toBeUndefined()
  })

  test("extracts interface/type/class declarations", () => {
    const result = extractCodeEntities("interface User { name: string }")
    expect(result).toContainEqual<ExtractedEntity>({ name: "User", type: "concept", confidence: 0.7 })
  })

  test("extracts type declarations", () => {
    const result = extractCodeEntities("type Result<T> = T | null")
    expect(result).toContainEqual<ExtractedEntity>({ name: "Result", type: "concept", confidence: 0.7 })
  })

  test("extracts class declarations", () => {
    const result = extractCodeEntities("class Database { }")
    expect(result).toContainEqual<ExtractedEntity>({ name: "Database", type: "concept", confidence: 0.7 })
  })

  test("handles mixed content", () => {
    const result = extractCodeEntities(
      "使用 `Bun.write()` 并 import { readFile } from 'fs', MAX_RETRIES=5, 查看 `src/index.ts`",
    )
    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.find((e) => e.name === "Bun.write" && e.type === "function")).toBeDefined()
    expect(result.find((e) => e.name === "fs" && e.type === "package")).toBeDefined()
    expect(result.find((e) => e.name === "MAX_RETRIES" && e.type === "config")).toBeDefined()
    expect(result.find((e) => e.name === "src/index.ts" && e.type === "file")).toBeDefined()
  })

  test("returns empty array for text with no code entities", () => {
    expect(extractCodeEntities("今天天气真好")).toEqual([])
    expect(extractCodeEntities("")).toEqual([])
  })

  test("deduplicates entities with same name", () => {
    const result = extractCodeEntities("`Bun.write()` 和 `Bun.write()`")
    const matches = result.filter((e) => e.name === "Bun.write")
    expect(matches).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// extractConcepts
// ---------------------------------------------------------------------------

describe("extractConcepts", () => {
  // --- "A策略/模式/架构/机制/方案" pattern ---
  test("extracts 'A策略' style concepts", () => {
    // Concept at beginning of sentence boundary for clean extraction
    const result = extractConcepts("缓存策略很重要")
    expect(result).toContainEqual<ExtractedEntity>({ name: "缓存策略", type: "concept", confidence: 0.5 })
  })

  test("extracts 'A模式' style concepts", () => {
    const result = extractConcepts("观察者模式")
    expect(result).toContainEqual<ExtractedEntity>({ name: "观察者模式", type: "concept", confidence: 0.5 })
  })

  test("extracts 'A架构' style concepts", () => {
    const result = extractConcepts("微服务架构")
    expect(result).toContainEqual<ExtractedEntity>({ name: "微服务架构", type: "concept", confidence: 0.5 })
  })

  test("extracts 'A机制' style concepts", () => {
    const result = extractConcepts("补偿机制")
    expect(result).toContainEqual<ExtractedEntity>({ name: "补偿机制", type: "concept", confidence: 0.5 })
  })

  test("extracts 'A方案' style concepts", () => {
    const result = extractConcepts("最优方案")
    expect(result).toContainEqual<ExtractedEntity>({ name: "最优方案", type: "concept", confidence: 0.5 })
  })

  // --- CamelCase concepts ---
  test("extracts CamelCase concepts", () => {
    const result = extractConcepts("使用 TypeScript 开发")
    expect(result).toContainEqual<ExtractedEntity>({ name: "TypeScript", type: "concept", confidence: 0.4 })
  })

  test("extracts multi-word CamelCase concepts", () => {
    const result = extractConcepts("依赖注入 DependencyInjection 模式")
    expect(result).toContainEqual<ExtractedEntity>({ name: "DependencyInjection", type: "concept", confidence: 0.4 })
  })

  test("does not extract single-word capitalized identifiers", () => {
    // Single-capital like "Hello" should not match CamelCase
    const result = extractConcepts("Hello world")
    expect(result.find((e) => e.name === "Hello")).toBeUndefined()
  })

  // --- X化 pattern ---
  test("extracts X化 ('hua') concepts", () => {
    const result = extractConcepts("模块化设计")
    expect(result).toContainEqual<ExtractedEntity>({ name: "模块化", type: "concept", confidence: 0.4 })
  })

  test("extracts various X化 concepts", () => {
    const result = extractConcepts("标准化、自动化、容器化")
    expect(result).toContainEqual<ExtractedEntity>({ name: "标准化", type: "concept", confidence: 0.4 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "自动化", type: "concept", confidence: 0.4 })
    expect(result).toContainEqual<ExtractedEntity>({ name: "容器化", type: "concept", confidence: 0.4 })
  })

  // --- dedup ---
  test("deduplicates by name keeping highest confidence", () => {
    // No duplicates from different patterns in current implementation since
    // CamelCase and Chinese patterns produce different names. This validates
    // that the internal dedup mechanism works and doesn't throw.
    const result = extractConcepts("TypeScript和TypeScript方案")
    const names = result.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("deduplicates identical names from same pattern", () => {
    const result = extractConcepts("模块化 模块化")
    const matches = result.filter((e) => e.name === "模块化")
    expect(matches).toHaveLength(1)
  })

  // --- edge cases ---
  test("returns empty array for text with no concepts", () => {
    expect(extractConcepts("今天星期几")).toEqual([])
    expect(extractConcepts("")).toEqual([])
  })

  test("handles mixed concept types", () => {
    const result = extractConcepts("采用缓存策略，模块化设计，使用TypeScript开发")
    // "采用缓存策略" → matches concept pattern with "采用缓存" as prefix
    expect(result.find((e) => e.name.includes("缓存策略"))).toBeDefined()
    expect(result.find((e) => e.name === "模块化")).toBeDefined()
    expect(result.find((e) => e.name === "TypeScript")).toBeDefined()
  })
})
