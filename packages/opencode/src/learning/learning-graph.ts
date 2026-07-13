import path from "path"
import crypto from "crypto"
import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Skill } from "@/skill"
import { Global } from "@/global"
import { Database } from "@/storage"
import { LearningNodeTable, LearningEdgeTable } from "./learning.sql"
import type { GraphNode, GraphEdge, GraphCluster, GraphStats, LearningGraph } from "./types"

const MIN_TOKEN_LEN = 3
const MAX_MEMORY_EDGES_PER_CARD = 4
const SKILL_SKILL_MIN_OVERLAP = 3

const tokenize = (text: string): Set<string> => {
  const tokens = new Set<string>()
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= MIN_TOKEN_LEN) tokens.add(t)
  }
  return tokens
}

type SkillMeta = {
  name: string
  description: string
  bundled: boolean
  tokens: Set<string>
}

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

/** Deterministic fingerprint of all graph inputs. */
const computeFingerprint = (skills: Skill.Info[], memoryBodies: string[]): string => {
  const parts: string[] = []
  for (const s of skills.toSorted((a, b) => a.name.localeCompare(b.name))) {
    parts.push(`${s.name}:${s.description}`)
  }
  parts.push("")
  for (const b of memoryBodies.sort()) {
    parts.push(b)
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)
}

/** Build in-memory model from current data sources.  Returns nodes, edges, and the memory cards. */
const computeGraph = (
  allSkills: Skill.Info[],
  memoryData: Array<{ pid: string; body: string }>,
  now: number,
): { nodes: GraphNode[]; edges: GraphEdge[]; memoryCards: string[] } => {
  const learned = allSkills.filter((s) => !s.bundled)

  const skillNodes: GraphNode[] = learned.map((s) => ({
    id: s.name,
    label: s.name,
    kind: "skill" as const,
    category: "",
    useCount: 0,
    state: "active",
    bundled: false,
    timestamp: now,
  }))

  const skillMeta: SkillMeta[] = learned.map((s) => ({
    name: s.name,
    description: s.description,
    bundled: !!s.bundled,
    tokens: tokenize(`${s.name} ${s.description}`),
  }))

  // Memory nodes + cards
  const memoryNodes: GraphNode[] = []
  const memoryCards: string[] = []

  for (const { pid, body } of memoryData) {
    const cards = splitCards(body)
    for (let i = 0; i < cards.length; i++) {
      const id = `memory:${pid}:${i}`
      const firstLine =
        cards[i]
          .split("\n")[0]
          ?.replace(/^##\s*/, "")
          .trim() ?? ""
      memoryNodes.push({
        id,
        label: firstLine.slice(0, 60) || `card-${i}`,
        kind: "memory" as const,
        category: "memory",
        useCount: 0,
        state: "active",
        bundled: false,
        timestamp: now,
        memorySource: "memory",
      })
      memoryCards.push(cards[i])
    }
  }

  // Skill ↔ Skill edges (description token overlap)
  const skillEdges: GraphEdge[] = []
  const seen = new Set<string>()

  for (let i = 0; i < skillMeta.length; i++) {
    for (let j = i + 1; j < skillMeta.length; j++) {
      const a = skillMeta[i]
      const b = skillMeta[j]
      const intersection = new Set<string>()
      for (const t of a.tokens) {
        if (b.tokens.has(t)) intersection.add(t)
      }
      if (intersection.size >= SKILL_SKILL_MIN_OVERLAP) {
        const [sa, sb] = [a.name, b.name].sort()
        const key = `${sa}::${sb}`
        if (!seen.has(key)) {
          seen.add(key)
          skillEdges.push({ source: sa, target: sb, weight: intersection.size })
        }
      }
    }
  }

  // Memory ↔ Skill edges
  const memorySkillEdges: GraphEdge[] = []

  for (let ci = 0; ci < memoryCards.length; ci++) {
    const cardText = memoryCards[ci]
    const memId = memoryNodes[ci].id
    const textTokens = tokenize(cardText)
    const scored: Array<{ score: number; skillName: string }> = []

    for (const sm of skillMeta) {
      let score = 0
      const nameLower = sm.name.toLowerCase()
      if (cardText.toLowerCase().includes(nameLower)) score += 6
      let overlap = 0
      for (const t of sm.tokens) {
        if (textTokens.has(t)) overlap++
      }
      score += overlap
      if (score > 0) scored.push({ score, skillName: sm.name })
    }

    scored.sort((a, b) => b.score - a.score || a.skillName.localeCompare(b.skillName))
    for (const hit of scored.slice(0, MAX_MEMORY_EDGES_PER_CARD)) {
      memorySkillEdges.push({ source: memId, target: hit.skillName, weight: hit.score })
    }
  }

  return {
    nodes: [...skillNodes, ...memoryNodes],
    edges: [...skillEdges, ...memorySkillEdges],
    memoryCards,
  }
}

/** Build stats + clusters from raw nodes & edges. */
const buildGraph = (nodes: GraphNode[], edges: GraphEdge[], memoryCards: string[]): LearningGraph => {
  const catCount = new Map<string, number>()
  for (const n of nodes) {
    const cat = n.category || "uncategorized"
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1)
  }
  const clusters: GraphCluster[] = Array.from(catCount.entries()).map(([c, n]) => ({ category: c, count: n }))

  const linked = new Set<string>()
  for (const e of edges) {
    linked.add(e.source)
    linked.add(e.target)
  }
  const totalNodes = nodes.length
  const totalEdges = edges.length
  const linkedNodes = linked.size
  const isolated = Math.max(0, totalNodes - linked.size)
  const skillNodes = nodes.filter((n) => n.kind === "skill")

  const stats: GraphStats = {
    nodes: totalNodes,
    edges: totalEdges,
    edgesPerNode: totalNodes > 0 ? Math.round((totalEdges / totalNodes) * 1000) / 1000 : 0,
    linkedNodes,
    isolatedPct: totalNodes > 0 ? Math.round((isolated / totalNodes) * 1000) / 10 : 0,
    bundled: 0,
    userCreated: skillNodes.filter((n) => !n.bundled).length,
    used: skillNodes.length,
    memoryNodes: nodes.filter((n) => n.kind === "memory").length,
    memorySkillEdges: edges.filter((e) => e.source.startsWith("memory:") || e.target.startsWith("memory:")).length,
  }

  return { nodes, edges, clusters, memory: memoryCards, stats }
}

/** Read memory files across all projects. */
const readMemoryDir = (
  fsys: AppFileSystem.Interface,
  memoryDir: string,
): Effect.Effect<Array<{ pid: string; body: string }>, never> =>
  Effect.gen(function* () {
    const isDir = yield* fsys.isDir(memoryDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!isDir) return []

    const entries = yield* fsys.readDirectoryEntries(memoryDir).pipe(Effect.catch(() => Effect.succeed([])))
    const result: Array<{ pid: string; body: string }> = []

    for (const entry of entries) {
      if (entry.type !== "directory") continue
      const memPath = path.join(memoryDir, entry.name, "MEMORY.md")
      const exists = yield* fsys.existsSafe(memPath).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) continue
      const body = yield* fsys.readFileString(memPath).pipe(Effect.catch(() => Effect.succeed("")))
      if (body) result.push({ pid: entry.name, body })
    }

    return result
  })

/** Reconstruct the full graph from SQLite + memory file cards. */
const readGraphFromDb = (memoryCards: string[]): Effect.Effect<LearningGraph, never> =>
  Effect.sync(() =>
    Database.use((db) => {
      const nodeRows = db.select().from(LearningNodeTable).all()
      const edgeRows = db.select().from(LearningEdgeTable).all()

      const nodes: GraphNode[] = nodeRows.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind as "skill" | "memory",
        category: r.category || undefined,
        useCount: r.use_count,
        state: r.state,
        bundled: r.bundled,
        timestamp: r.timestamp ?? undefined,
        memorySource: r.memory_source ?? undefined,
      }))

      const edges: GraphEdge[] = edgeRows.map((r) => ({
        source: r.source,
        target: r.target,
        weight: r.weight,
      }))

      return buildGraph(nodes, edges, memoryCards)
    }),
  )

/** Write graph to SQLite in a single transaction with batch inserts. */
const writeGraphToDb = (result: { nodes: GraphNode[]; edges: GraphEdge[] }, fp: string): void => {
  // Ensure tables exist (defensive — migration should have created them)
  Database.Client().$client.exec(`
    CREATE TABLE IF NOT EXISTS learning_node (
      id text PRIMARY KEY NOT NULL,
      label text NOT NULL,
      kind text NOT NULL,
      category text DEFAULT '',
      use_count integer DEFAULT 0,
      state text DEFAULT 'active',
      bundled integer DEFAULT 0,
      timestamp integer,
      memory_source text,
      fingerprint text NOT NULL DEFAULT '',
      last_built_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_edge (
      source text NOT NULL REFERENCES learning_node(id) ON DELETE CASCADE,
      target text NOT NULL REFERENCES learning_node(id) ON DELETE CASCADE,
      weight real NOT NULL DEFAULT 0,
      edge_type text NOT NULL DEFAULT 'skill-skill',
      last_built_at integer NOT NULL,
      PRIMARY KEY (source, target, edge_type)
    );
  `)

  Database.transaction((tx) => {
    tx.delete(LearningEdgeTable).run()
    tx.delete(LearningNodeTable).run()

    const now = Date.now()

    // Batch insert all nodes
    if (result.nodes.length > 0) {
      tx.insert(LearningNodeTable)
        .values(
          result.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            kind: n.kind,
            category: n.category ?? "",
            use_count: n.useCount,
            state: n.state,
            bundled: n.bundled,
            timestamp: n.timestamp ?? null,
            memory_source: n.memorySource ?? null,
            fingerprint: fp,
            last_built_at: now,
          })),
        )
        .run()
    }

    // Batch insert all edges
    if (result.edges.length > 0) {
      tx.insert(LearningEdgeTable)
        .values(
          result.edges.map((e) => ({
            source: e.source,
            target: e.target,
            weight: e.weight,
            edge_type:
              e.source.startsWith("memory:") || e.target.startsWith("memory:") ? "memory-skill" : "skill-skill",
            last_built_at: now,
          })),
        )
        .run()
    }
  })
}

export interface Interface {
  readonly build: () => Effect.Effect<LearningGraph>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LearningGraph") {}

export const layer: Layer.Layer<Service, never, Skill.Service | AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const fsys = yield* AppFileSystem.Service

    const build = Effect.fn("LearningGraph.build")(function* () {
      const allSkills = yield* skill.all()
      const now = Math.floor(Date.now() / 1000)

      const dataRoot = Global.Path.data
      const memoryDir = path.join(dataRoot, "memory", "projects")
      const memoryData = yield* readMemoryDir(fsys, memoryDir)
      const memoryBodies = memoryData.map((m) => m.body)

      // Compute fingerprint of current inputs (skills + memory content).
      // If a memory file is deleted, its body won't appear here → fingerprint changes → cache miss → cleanup.
      const fp = computeFingerprint(allSkills, memoryBodies)

      // Check cache by fingerprint
      const cached = yield* Effect.sync(
        () =>
          Database.Client().$client.query("SELECT fingerprint FROM learning_node LIMIT 1").get() as
            { fingerprint: string } | undefined,
      )

      if (cached && cached.fingerprint === fp) {
        // Fast path: read nodes/edges from SQLite, derive memory cards from current files
        const cards = splitMemoryBodies(memoryData)
        return yield* readGraphFromDb(cards)
      }

      // Cache miss: rebuild everything, persist, return
      const result = computeGraph(allSkills, memoryData, now)
      yield* Effect.sync(() => writeGraphToDb({ nodes: result.nodes, edges: result.edges }, fp))

      return buildGraph(result.nodes, result.edges, result.memoryCards)
    })

    return Service.of({ build })
  }),
)

const splitMemoryBodies = (memoryData: Array<{ pid: string; body: string }>): string[] => {
  const cards: string[] = []
  for (const { body } of memoryData) {
    cards.push(...splitCards(body))
  }
  return cards
}

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Skill.defaultLayer)))
