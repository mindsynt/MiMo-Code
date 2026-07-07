import { Effect } from "effect"
import z from "zod"
import { traverseGraph, queryEntity } from "@/memory/entities"
import DESCRIPTION from "./memory-graph.txt"
import * as Tool from "./tool"

export const parameters = z.object({
  operation: z.enum(["traverse", "subgraph"]).default("traverse").describe("Graph operation to perform"),
  from: z.string().optional().describe("Starting entity name for the traverse operation"),
  entities: z.array(z.string()).optional().describe("Entity names for the subgraph operation"),
  relation: z.string().optional().describe("Filter relations by type (traverse only)"),
  depth: z.number().default(2).describe("Traversal depth, max 5 (traverse only)"),
})

export function traverse(from: string, relation?: string, depth = 2) {
  const fromEntity = queryEntity(from)
  if (!fromEntity) {
    return {
      title: `Memory graph: entity not found`,
      output: `Entity "${from}" was not found in the memory graph.`,
      metadata: { entity_found: false },
    }
  }

  const paths = traverseGraph(from, { relation, depth })

  if (paths.length === 0) {
    return {
      title: `Memory graph: 0 paths from ${from}`,
      output: [
        `Entity: ${from}`,
        `  type: ${fromEntity.type}, tier: ${fromEntity.tier}, confidence: ${fromEntity.confidence.toFixed(3)}`,
        ``,
        `Entity exists but has no outgoing relations.`,
      ].join("\n"),
      metadata: {
        entity_type: fromEntity.type,
        entity_tier: fromEntity.tier,
        entity_confidence: fromEntity.confidence,
        count: 0,
      },
    }
  }

  const lines = [
    `Entity: ${from}`,
    `  type: ${fromEntity.type}, tier: ${fromEntity.tier}, confidence: ${fromEntity.confidence.toFixed(3)}`,
    `Traversal: depth ${depth}${relation ? `, filtered by relation "${relation}"` : ""}`,
    `Found ${paths.length} connection${paths.length === 1 ? "" : "s"}.`,
    ``,
  ]
  for (const p of paths) {
    lines.push(`  ${p.source_name} ──[${p.relation_type}]──▶ ${p.target_name} (${p.target_type}) [depth ${p.depth}]`)
  }
  return {
    title: `Memory graph: ${paths.length} path${paths.length === 1 ? "" : "s"} from ${from}`,
    output: lines.join("\n"),
    metadata: { count: paths.length },
  }
}

export function subgraph(entities: string[]) {
  const found: Array<{ name: string; type: string; tier: string; confidence: number }> = []
  const notFound: string[] = []

  for (const name of entities) {
    const entity = queryEntity(name)
    if (entity) {
      found.push(entity)
    } else {
      notFound.push(name)
    }
  }

  if (found.length === 0) {
    return {
      title: `Memory graph: no entities found`,
      output: `None of the requested entities were found: ${notFound.join(", ")}`,
      metadata: { entity_count: 0, relation_count: 0 },
    }
  }

  const entityNameSet = new Set(found.map((e) => e.name))
  const lines: string[] = [`Found ${found.length} entit${found.length === 1 ? "y" : "ies"}:`, ``]
  for (const e of found) {
    lines.push(`  ${e.name}`)
    lines.push(`    type: ${e.type}, tier: ${e.tier}, confidence: ${e.confidence.toFixed(3)}`)
  }

  const relationLines: string[] = []
  for (const e of found) {
    const paths = traverseGraph(e.name, { depth: 1 })
    for (const p of paths) {
      if (entityNameSet.has(p.target_name)) {
        relationLines.push(`  ${p.source_name} ──[${p.relation_type}]──▶ ${p.target_name}`)
      }
    }
  }

  if (relationLines.length > 0) {
    lines.push(``)
    lines.push(`Relations among requested entities:`)
    lines.push(...relationLines)
  }

  if (notFound.length > 0) {
    lines.push(``)
    lines.push(`Not found: ${notFound.join(", ")}`)
  }

  return {
    title: `Memory graph: ${found.length} entit${found.length === 1 ? "y" : "ies"}, ${relationLines.length} relation${relationLines.length === 1 ? "" : "s"}`,
    output: lines.join("\n"),
    metadata: { entity_count: found.length, relation_count: relationLines.length },
  }
}

export const MemoryGraphTool = Tool.define(
  "memory-graph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          if (args.operation === "traverse") {
            if (!args.from) {
              return {
                title: `Memory graph: traverse requires 'from'`,
                output: "The 'traverse' operation requires a 'from' parameter specifying the entity to start from.",
                metadata: {},
              }
            }
            return traverse(args.from, args.relation, args.depth)
          }
          if (!args.entities || args.entities.length === 0) {
            return {
              title: `Memory graph: subgraph requires 'entities'`,
              output: "The 'subgraph' operation requires an 'entities' parameter with at least one entity name.",
              metadata: {},
            }
          }
          return subgraph(args.entities)
        }),
    }
  }),
)
