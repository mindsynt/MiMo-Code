import { Context, Effect, Layer } from "effect"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Database } from "../storage"
import { Config } from "../config"
import { reconcileMemory } from "./reconcile"
import { buildFtsQuery } from "./fts-query"

type SearchRow = {
  path: string
  scope: string
  scope_id: string
  type: string
  snippet: string
  score: number
}

export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly reconcile: () => Effect.Effect<{ indexed: number; pruned: number }>
  readonly search: (input: {
    query: string
    scope?: string
    scope_id?: string
    type?: string
    limit?: number
  }) => Effect.Effect<
    Array<{ path: string; snippet: string; score: number; scope: string; scope_id: string; type: string }>
  >

  readonly graphTraverse: (input: { from: string; relation?: string; depth?: number }) => Effect.Effect<
    Array<{
      source_name: string
      relation_type: string | null
      target_name: string
      target_type: string
      depth: number
    }>
  >

  readonly decayEntities: () => Effect.Effect<{ pruned: number }>

  readonly vectorSearch: (input: { query: string; topK?: number }) => Effect.Effect<
    Array<{
      text: string
      score: number
      source: string
      chunkId?: number
    }>
  >

  readonly getPreference: (
    key: string,
  ) => Effect.Effect<{ key: string; value: string; category: string; confidence: number; source: string } | undefined>
  readonly listPreferences: (
    category?: string,
  ) => Effect.Effect<Array<{ key: string; value: string; category: string; confidence: number; source: string }>>
  readonly cleanupExpired: () => Effect.Effect<{ expiredChunks: number; expiredVectors: number }>
  readonly runReflection: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const root = path.join(Global.Path.data, "memory")
    const ccBase = path.join(os.homedir(), ".claude", "projects")

    const rootEff = Effect.fn("Memory.root")(function* () {
      return root
    })

    const reconcile = Effect.fn("Memory.reconcile")(function* () {
      const cfg = yield* config.get()
      const cc = cfg.memory?.cc_index ? ccBase : undefined
      return yield* Effect.promise(() => reconcileMemory({ mimo: root, cc }))
    })

    const search = Effect.fn("Memory.search")(function* (input: {
      query: string
      scope?: string
      scope_id?: string
      type?: string
      limit?: number
    }) {
      // Lazy reconcile before search (covers off-tool writes); honour config flag.
      const cfg = yield* config.get()
      if (cfg.checkpoint?.memory_reconcile_on_search ?? true) {
        const cc = cfg.memory?.cc_index ? ccBase : undefined
        yield* Effect.promise(() => reconcileMemory({ mimo: root, cc }))
      }

      const limit = input.limit ?? 10
      // Build a token-level FTS5 query: punctuation becomes separators,
      // each alphanumeric run becomes a phrase-quoted literal, OR-joined.
      // See packages/opencode/src/memory/fts-query.ts for the rationale.
      const ftsQuery = buildFtsQuery(input.query)
      if (!ftsQuery) return []

      // OR-join means a doc matching only a common word (e.g. every
      // checkpoint.md matches "checkpoint") still matches, but BM25 ranks it
      // far below a doc matching several rare query words. We drop the
      // common-word noise with a RELATIVE floor: keep results scoring at
      // least `ratio` of the top hit's score. Relative (not absolute)
      // because BM25 magnitudes are corpus-size-dependent — in a tiny corpus
      // every score collapses toward 0 (low IDF), so any fixed absolute floor
      // would wrongly wipe real hits. The #1 result is ALWAYS kept (a match
      // is a match even when BM25 can't discriminate). Default 0.15.
      // Configurable; 0 disables (keep all matches).
      const floorRatio = cfg.checkpoint?.memory_search_score_floor ?? 0.15

      // Construct WHERE clauses for scope/scope_id/type filtering
      const conditions: string[] = []
      const params: string[] = []
      if (input.scope) {
        conditions.push("memory_fts.scope = ?")
        params.push(input.scope)
      }
      if (input.scope_id) {
        conditions.push("memory_fts.scope_id = ?")
        params.push(input.scope_id)
      }
      if (input.type) {
        conditions.push("memory_fts.type = ?")
        params.push(input.type)
      }
      const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""

      const sql = `
        SELECT memory_fts.path, memory_fts.scope, memory_fts.scope_id, memory_fts.type,
               snippet(memory_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
               bm25(memory_fts_idx) AS score
        FROM memory_fts_idx
        JOIN memory_fts ON memory_fts.id = memory_fts_idx.rowid
        WHERE memory_fts_idx MATCH ?
        ${whereClause}
        ORDER BY score
        LIMIT ?
      `

      // Over-fetch (3x, capped) so the relative floor can trim common-word
      // noise without starving the list when there ARE enough real hits.
      const fetchLimit = Math.min(limit * 3, 50)
      const rows = Database.Client()
        .$client.query(sql)
        .all(ftsQuery, ...params, fetchLimit) as SearchRow[]

      // FTS5 bm25() returns lower = better; convert to higher = better for caller
      const mapped = rows.map((r) => ({
        path: r.path,
        snippet: r.snippet,
        score: -r.score,
        scope: r.scope,
        scope_id: r.scope_id,
        type: r.type,
      }))
      if (mapped.length === 0) return []
      // Rows are ORDER BY score (best first), so mapped[0] is the top hit.
      // Always keep it; drop trailing rows below `floorRatio` of its score.
      const topScore = mapped[0].score
      const cutoff = floorRatio > 0 ? topScore * floorRatio : -Infinity
      return mapped.filter((r, i) => i === 0 || r.score >= cutoff).slice(0, limit)
    })

    const graphTraverse = Effect.fn("Memory.graphTraverse")(function* (input: {
      from: string
      relation?: string
      depth?: number
    }) {
      const { traverseGraph } = yield* Effect.promise(() => import("./entities"))
      return yield* Effect.sync(() => traverseGraph(input.from, { relation: input.relation, depth: input.depth }))
    })

    const decayEntities = Effect.fn("Memory.decayEntities")(function* () {
      const { decayLowConfidence } = yield* Effect.promise(() => import("./entities"))
      return yield* Effect.sync(() => decayLowConfidence())
    })

    const vectorSearch = Effect.fn("Memory.vectorSearch")(function* (input: { query: string; topK?: number }) {
      const { hybridSearch } = yield* Effect.promise(() => import("./hybrid-search"))
      return yield* Effect.promise(() =>
        hybridSearch(
          input.query,
          Service.of({
            root: rootEff,
            reconcile,
            search,
            graphTraverse,
            decayEntities,
            vectorSearch: undefined as never,
            getPreference: undefined as never,
            listPreferences: undefined as never,
            cleanupExpired: undefined as never,
            runReflection: undefined as never,
          } as Interface),
          {
            mode: "hybrid",
            topK: input.topK ?? 10,
          },
        ),
      )
    })

    const getPreferenceEff = Effect.fn("Memory.getPreference")(function* (key: string) {
      const { getPreference } = yield* Effect.promise(() => import("./profile"))
      return yield* Effect.sync(() => getPreference(key))
    })

    const listPreferencesEff = Effect.fn("Memory.listPreferences")(function* (category?: string) {
      const { listPreferences } = yield* Effect.promise(() => import("./profile"))
      return yield* Effect.sync(() => listPreferences(category))
    })

    const cleanupExpiredEff = Effect.fn("Memory.cleanupExpired")(function* () {
      const { cleanupExpired } = yield* Effect.promise(() => import("./cleanup"))
      return yield* Effect.sync(() => cleanupExpired())
    })

    const runReflectionEff = Effect.fn("Memory.runReflection")(function* () {
      const { runReflection } = yield* Effect.promise(() => import("./reflection"))
      return yield* Effect.promise(() => runReflection())
    })

    return Service.of({
      root: rootEff,
      reconcile,
      search,
      graphTraverse,
      decayEntities,
      vectorSearch,
      getPreference: getPreferenceEff,
      listPreferences: listPreferencesEff,
      cleanupExpired: cleanupExpiredEff,
      runReflection: runReflectionEff,
    })
  }),
)

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Config.defaultLayer)))
