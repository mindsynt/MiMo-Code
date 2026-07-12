import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { createShellParser } from "../../src/tool/shell-parse-generic"
import z from "zod"

async function parseOk(parser: ReturnType<typeof createShellParser>, script: string): Promise<any[]> {
  const exit = await Effect.runPromise(Effect.exit(parser.parse(script)))
  if (exit._tag === "Failure") throw new Error(`expected success: ${JSON.stringify(exit.cause)}`)
  return exit.value
}

async function parseErr(parser: ReturnType<typeof createShellParser>, script: string): Promise<string> {
  const exit = await Effect.runPromise(Effect.exit(parser.parse(script)))
  if (exit._tag !== "Failure") throw new Error("expected failure, got success")
  const bcause: any = exit.cause
  const fail = bcause.reasons?.find?.((r: any) => r._tag === "Fail")
  if (!fail) throw new Error(`no Fail reason: ${JSON.stringify(bcause)}`)
  return fail.error.detail ?? fail.error.kind
}

describe("shell-parse-generic: flat object", () => {
  const readSchema = z.object({
    file_path: z.string(),
    offset: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
  })

  test("positional required args", async () => {
    const parser = createShellParser(readSchema)
    const out = await parseOk(parser, "/foo/bar.ts")
    expect(out).toEqual([{ file_path: "/foo/bar.ts" }])
  })

  test("positional + --flags", async () => {
    const parser = createShellParser(readSchema)
    const out = await parseOk(parser, "/foo/bar.ts --offset 10 --limit 50")
    expect(out).toEqual([{ file_path: "/foo/bar.ts", offset: 10, limit: 50 }])
  })

  test("multi-line = multi-command", async () => {
    const parser = createShellParser(readSchema)
    const out = await parseOk(parser, "a.ts\nb.ts")
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ file_path: "a.ts" })
    expect(out[1]).toEqual({ file_path: "b.ts" })
  })
})

describe("shell-parse-generic: --flag mapping", () => {
  const grepSchema = z.object({
    pattern: z.string(),
    path: z.string().optional(),
    include: z.string().optional(),
  })

  test("kebab-case --flag maps to underscore key", async () => {
    const parser = createShellParser(grepSchema)
    // --include maps to `include` (direct match)
    const out = await parseOk(parser, "TODO --path /src --include '*.ts'")
    expect(out).toEqual([{ pattern: "TODO", path: "/src", include: "*.ts" }])
  })
})

describe("shell-parse-generic: type coercion", () => {
  const bashSchema = z.object({
    command: z.string(),
    timeout: z.coerce.number().optional(),
    interactive: z.boolean().optional(),
  })

  test("number coercion", async () => {
    const parser = createShellParser(bashSchema)
    const out = await parseOk(parser, "ls -la --timeout 5000")
    expect(out).toEqual([{ command: "ls -la", timeout: 5000 }])
  })

  test("boolean --flag (no value)", async () => {
    const parser = createShellParser(bashSchema)
    const out = await parseOk(parser, "npm install --interactive")
    expect(out).toEqual([{ command: "npm install", interactive: true }])
  })
})

describe("shell-parse-generic: enum fields", () => {
  const schema = z.object({
    kind: z.enum(["search", "around"]),
    query: z.string().optional(),
  })

  test("enum exact match", async () => {
    const parser = createShellParser(schema)
    const out = await parseOk(parser, "search --query hello")
    expect(out).toEqual([{ kind: "search", query: "hello" }])
  })
})

describe("shell-parse-generic: array/JSON values", () => {
  const multieditSchema = z.object({
    file_path: z.string(),
    edits: z.array(z.object({
      old_string: z.string(),
      new_string: z.string(),
    })),
  })

  test("JSON array value", async () => {
    const parser = createShellParser(multieditSchema)
    const json = '[{"old_string":"a","new_string":"b"}]'
    const out = await parseOk(parser, `/foo.ts --edits '${json}'`)
    expect(out).toEqual([{ file_path: "/foo.ts", edits: [{ old_string: "a", new_string: "b" }] }])
  })

  test("invalid JSON fails", async () => {
    const parser = createShellParser(multieditSchema)
    const detail = await parseErr(parser, `/foo.ts --edits 'not-json'`)
    expect(detail).toContain("JSON")
  })
})

describe("shell-parse-generic: discriminatedUnion", () => {
  const runSchema = z.object({ operation: z.literal("run"), name: z.string().optional(), script: z.string().optional() })
  const statusSchema = z.object({ operation: z.literal("status"), run_id: z.string() })
  const schema = z.discriminatedUnion("operation", [runSchema, statusSchema])

  test("first token is discriminator", async () => {
    const parser = createShellParser(schema)
    const out = await parseOk(parser, "status wf_abc")
    expect(out).toEqual([{ operation: "status", run_id: "wf_abc" }])
  })

  test("run with --flags", async () => {
    const parser = createShellParser(schema)
    const out = await parseOk(parser, "run --name deep-research")
    expect(out).toEqual([{ operation: "run", name: "deep-research" }])
  })
})

describe("shell-parse-generic: recover", () => {
  const readSchema = z.object({
    file_path: z.string(),
    offset: z.coerce.number().optional(),
  })

  test("recovers from JSON-shaped args", () => {
    const parser = createShellParser(readSchema)
    const recovered = parser.recover?.({ file_path: "/foo.ts", offset: 10 })
    expect(recovered).toBeDefined()
    expect(recovered).toEqual({ file_path: "/foo.ts", offset: 10 })
  })

  test("recover returns undefined for invalid input", () => {
    const parser = createShellParser(readSchema)
    expect(parser.recover?.("not an object")).toBeUndefined()
    expect(parser.recover?.(null)).toBeUndefined()
    expect(parser.recover?.({})).toBeUndefined()
  })
})

describe("shell-parse-generic: description auto-generation", () => {
  test("flat object generates syntax", () => {
    const schema = z.object({
      file_path: z.string(),
      offset: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    })
    const parser = createShellParser(schema)
    expect(parser.description).toContain("<file_path>")
    expect(parser.description).toContain("--offset")
    expect(parser.description).toContain("--limit")
  })
})
