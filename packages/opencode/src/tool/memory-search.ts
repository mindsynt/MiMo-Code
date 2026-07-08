import { Effect } from "effect"
import z from "zod"
import { Memory } from "@/memory"
import { traverseGraph } from "@/memory/entities"
import { getVectorIndex, generateEmbedding } from "@/memory/vectors"
import DESCRIPTION from "./memory-search.txt"
import * as Tool from "./tool"

const parameters = z.object({
  query: z.string().describe("Search query"),
  mode: z.enum(["hybrid", "graph", "vector", "fts"]).default("hybrid").describe("Search mode"),
  topK: z.number().default(10).describe("Max results"),
})

type SearchItem = { text: string; score: number }

export const MemorySearchTool = Tool.define(
  "memory-search",
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    return {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const query = args.query
          const topK = args.topK
          const mode = args.mode

          const runGraph = Effect.fn("ms.graph")(function* () {
            const words = query.match(/\b\w+\b/g) ?? []
            if (words.length === 0) return [] as SearchItem[]
            const firstWord = words[0]
            if (!firstWord) return [] as SearchItem[]
            const paths = yield* Effect.sync(() => traverseGraph(firstWord))
            return paths.map((p) => ({
              text: `${p.source_name} ──[${p.relation_type}]──▶ ${p.target_name} (${p.target_type})`,
              score: 1 / (1 + p.depth),
            }))
          })

          const runVector = Effect.fn("ms.vector")(function* () {
            const index = getVectorIndex()
            if (index.size === 0) return [] as SearchItem[]
            const queryVec = yield* Effect.promise(() => generateEmbedding(query))
            return yield* Effect.sync(() =>
              index.search(queryVec, topK).map((r) => ({ text: r.chunkText, score: r.score })),
            )
          })

          const runFts = Effect.fn("ms.fts")(function* () {
            const results = yield* memory.search({ query, limit: topK })
            return results.map((r) => ({
              text: r.snippet.replace(/<<|>>/g, ""),
              score: Math.max(0, r.score),
            }))
          })

          let items: SearchItem[]
          if (mode === "hybrid") {
            const [g, v, f] = yield* Effect.all([runGraph(), runVector(), runFts()], { concurrency: "unbounded" })
            const all = [...g, ...v, ...f]
            if (all.length === 0)
              return { title: "Memory search: 0 results", output: "No results found.", metadata: { count: 0 } }
            const maxScore = Math.max(...all.map((r) => r.score), 1)
            const fused = all.map((r) => ({ ...r, score: r.score / maxScore }))
            fused.sort((a, b) => b.score - a.score)
            items = fused.slice(0, topK)
          } else if (mode === "graph") {
            items = yield* runGraph()
          } else if (mode === "vector") {
            items = yield* runVector()
          } else {
            items = yield* runFts()
          }

          if (items.length === 0) {
            return { title: "Memory search: 0 results", output: "No results found.", metadata: { count: 0 } }
          }

          const lines = [`Memory search (mode: ${mode}): ${items.length} result${items.length === 1 ? "" : "s"}`, ""]
          for (let i = 0; i < items.length; i++) {
            lines.push(`${i + 1}. [score=${items[i].score.toFixed(4)}] ${items[i].text.slice(0, 200)}`)
          }
          return {
            title: `Memory search: ${items.length} result${items.length === 1 ? "" : "s"}`,
            output: lines.join("\n"),
            metadata: { count: items.length },
          }
        }),
    }
  }),
)
