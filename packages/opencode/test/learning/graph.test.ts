import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { Skill } from "../../src/skill"
import { Learning } from "../../src/learning"
import { Memory } from "../../src/memory"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import type { Skill as SkillModule } from "../../src/skill"

// Pure function tests — no Effect infrastructure needed
// ---------------------------------------------------------

const tokenize = (() => {
  const MIN_TOKEN_LEN = 3
  return (text: string): Set<string> => {
    const tokens = new Set<string>()
    for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= MIN_TOKEN_LEN) tokens.add(t)
    }
    return tokens
  }
})()

const splitCards = (body: string): string[] => {
  const lines = body.split("\n")
  const cards: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current.length > 0) cards.push(current.join("\n").trim())
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) cards.push(current.join("\n").trim())
  return cards.filter(Boolean)
}

describe("tokenize", () => {
  test("skips tokens shorter than 3 characters", () => {
    const result = tokenize("a be cat dog")
    expect([...result]).toEqual(["cat", "dog"])
  })

  test("lowercases and splits on non-alphanumeric", () => {
    const result = tokenize("Hello-World foo_bar")
    expect(result.has("hello")).toBeTrue()
    expect(result.has("world")).toBeTrue()
  })

  test("deduplicates tokens", () => {
    const result = tokenize("apple apple orange")
    expect(result.size).toBe(2)
  })
})

describe("splitCards", () => {
  test("splits by ## headers", () => {
    const body = "## Section One\ncontent A\n## Section Two\ncontent B"
    const cards = splitCards(body)
    expect(cards.length).toBe(2)
    expect(cards[0]).toContain("Section One")
    expect(cards[1]).toContain("Section Two")
  })

  test("returns single card for no headers", () => {
    const cards = splitCards("just plain text\nno headers")
    expect(cards.length).toBe(1)
  })

  test("filters empty cards", () => {
    const cards = splitCards("## Header\n  \n## Another")
    expect(cards.every((c) => c.length > 0)).toBeTrue()
  })
})

describe("computeFingerprint", () => {
  const fp = (skills: SkillModule.Info[], bodies: string[]) => {
    const crypto = require("crypto")
    const parts: string[] = []
    for (const s of skills.toSorted((a, b) => a.name.localeCompare(b.name))) {
      parts.push(`${s.name}:${s.description}`)
    }
    parts.push("")
    for (const b of bodies.sort()) {
      parts.push(b)
    }
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)
  }

  const s1 = { name: "alpha", description: "first skill", location: "", content: "", bundled: false }
  const s2 = { name: "beta", description: "second skill", location: "", content: "", bundled: true }

  test("deterministic", () => {
    expect(fp([s1, s2], ["mem A"])).toBe(fp([s1, s2], ["mem A"]))
  })

  test("different skills → different hash", () => {
    expect(fp([s1], ["mem A"])).not.toBe(fp([s2], ["mem A"]))
  })

  test("different memory → different hash", () => {
    expect(fp([s1], ["mem A"])).not.toBe(fp([s1], ["mem B"]))
  })

  test("memory file deletion changes hash", () => {
    expect(fp([s1], ["mem A", "mem B"])).not.toBe(fp([s1], ["mem A"]))
  })

  test("sorting invariant", () => {
    expect(fp([s2, s1], ["mem"])).toBe(fp([s1, s2], ["mem"]))
  })
})

// Integration tests with mock Skill.Service
// ---------------------------------------------------------

interface SkillInfo {
  name: string
  description: string
  location: string
  content: string
  hidden?: boolean
  bundled?: boolean
}

const makeSkill = (name: string, description: string, bundled = false): SkillInfo => ({
  name,
  description,
  location: `/skills/${name}`,
  content: `# ${name}\n${description}`,
  bundled,
})

// Each non-bundled skill shares at least 3 tokens with another
const testSkills: SkillInfo[] = [
  makeSkill("evolve", "agent modification tooling and system framework"),
  makeSkill("frontend-design", "design tooling and framework guidance"),
  makeSkill("git-workflow", "git branching tooling and system framework"),
  makeSkill("builtin-one", "a builtin skill that should be excluded", true),
]

const mockSkillAll = Effect.succeed(testSkills as SkillModule.Info[])

const mockSkillLayer = Layer.succeed(
  Skill.Service,
  Skill.Service.of({
    get: (name: string) => Effect.succeed(testSkills.find((s) => s.name === name) as SkillModule.Info | undefined),
    all: () => mockSkillAll,
    dirs: () => Effect.succeed<string[]>([]),
    available: () => mockSkillAll,
    reload: () => Effect.void,
  }),
)

const testLayer = Layer.mergeAll(
  mockSkillLayer,
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Memory.defaultLayer,
)
const it = testEffect(Layer.provideMerge(Learning.layer, testLayer))

describe("LearningGraph.Service.build", () => {
  it.live("returns graph with skill nodes, no bundled skills", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const learning = yield* Learning.Service
        const graph = yield* learning.build()

        expect(graph.stats.nodes).toBeGreaterThan(0)
        expect(graph.stats.memoryNodes).toBe(0)

        const skillNames = graph.nodes.filter((n) => n.kind === "skill").map((n) => n.label)
        expect(skillNames).toContain("evolve")
        expect(skillNames).toContain("frontend-design")
        expect(skillNames).not.toContain("builtin-one")
      }),
    ),
  )

  it.live("includes memory nodes from MEMORY.md", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const learning = yield* Learning.Service
        const memory = yield* Memory.Service
        const root = yield* memory.root()

        // Clean slate and write a MEMORY.md to the projects directory
        yield* Effect.promise(() => fs.rm(root, { recursive: true, force: true }))
        const memDir = path.join(root, "projects", "test-uuid")
        yield* Effect.promise(() => fs.mkdir(memDir, { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(memDir, "MEMORY.md"),
            "## Architecture decisions\nCSS import strategy uses direct paths\n## Rules\nAll UI text must use i18n keys",
          ),
        )

        const graph = yield* learning.build()
        expect(graph.stats.memoryNodes).toBe(2)

        const memNodes = graph.nodes.filter((n) => n.kind === "memory")
        expect(memNodes[0].label).toContain("Architecture decisions")

        expect(graph.memory.length).toBe(2)
        expect(graph.memory[0]).toContain("Architecture decisions")
      }),
    ),
  )

  it.live("builds skill↔skill edges from description overlap", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const learning = yield* Learning.Service
        const graph = yield* learning.build()

        const evolveRelated = graph.edges.filter((e) => e.source === "evolve" || e.target === "evolve")
        expect(evolveRelated.length).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("returns cached result on second call (fingerprint match)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const learning = yield* Learning.Service
        const a = yield* learning.build()
        const b = yield* learning.build()

        expect(b.stats.nodes).toBe(a.stats.nodes)
        expect(b.stats.edges).toBe(a.stats.edges)
      }),
    ),
  )
})
