import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { shellWrap } from "../../src/tool/shell-wrap"
import { createShellParser } from "../../src/tool/shell-parse-generic"
import { tokenize } from "../../src/tool/shell-tokenize"
import z from "zod"
import * as Tool from "../../src/tool/tool"

/** shellWrap → generic parser 的完整端到端链路测试 */
describe("shell-parse-e2e: shellWrap + generic parser integration", () => {
  // 模拟一个 read 工具的简化定义
  const readDef: Tool.Def<any> = {
    id: "read",
    description: "Read a file",
    parameters: z.object({
      file_path: z.string(),
      offset: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
    execute: (args: any) =>
      Effect.succeed({
        title: "read",
        metadata: {} as any,
        output: JSON.stringify(args),
      }),
  }

  test("shellWrap + generic parser: basic positional", async () => {
    const parser = createShellParser(readDef.parameters)
    const wrapped = shellWrap(readDef, parser)
    // wrapped 接收 { script: string } 参数
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "/foo/bar.ts" }, null as any)),
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.output).toContain("/foo/bar.ts")
    }
  })

  test("shellWrap + generic parser: positional + flags", async () => {
    const parser = createShellParser(readDef.parameters)
    const wrapped = shellWrap(readDef, parser)
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "/foo/bar.ts --offset 10 --limit 50" }, null as any)),
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.output).toContain("offset")
      expect(exit.value.output).toContain("50")
    }
  })

  test("shellWrap + generic parser: multi-line = multi-command", async () => {
    const parser = createShellParser(readDef.parameters)
    const wrapped = shellWrap(readDef, parser)
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "a.ts\nb.ts" }, null as any)),
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      // 两行 = 两条命令，使用 shell-wrap 的 XML 格式
      expect(exit.value.output).toContain('command index="1"')
      expect(exit.value.output).toContain('command index="2"')
    }
  })

  test("shellWrap + generic parser: empty script error", async () => {
    const parser = createShellParser(readDef.parameters)
    const wrapped = shellWrap(readDef, parser)
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "" }, null as any)),
    )
    expect(exit._tag).toBe("Success") // shellWrap 自身不抛错，返回友好提示
    if (exit._tag === "Success") {
      expect(exit.value.output).toContain("takes a single")
    }
  })

  test("shellWrap + generic parser: recover from JSON args", async () => {
    // 模拟模型在 shell 模式下误发 JSON 格式的调用
    const parser = createShellParser(readDef.parameters)
    const wrapped = shellWrap(readDef, parser)
    // 传入一个看起来像 JSON 参数的调用（无 script 字段）
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "" } as any, null as any)),
    )
    expect(exit._tag).toBe("Success")
  })
})

describe("shell-parse-e2e: registry-style integration", () => {
  test("generic parser produces valid shell description", () => {
    const schema = z.object({
      file_path: z.string(),
      offset: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    })
    const parser = createShellParser(schema)
    expect(parser.description).toBeTruthy()
    expect(parser.description).toContain("<file_path>")
  })

  test("generic parser recover works with valid JSON", () => {
    const schema = z.object({
      file_path: z.string(),
      offset: z.coerce.number().optional(),
    })
    const parser = createShellParser(schema)
    const recovered = parser.recover?.({ file_path: "/test.ts", offset: 5 })
    expect(recovered).toBeDefined()
    expect(recovered).toEqual({ file_path: "/test.ts", offset: 5 })
  })
})

describe("shell-parse-e2e: bash tool integration", () => {
  // 模拟 bash 工具的简化 shell 语法
  const bashSchema = z.object({
    command: z.string(),
    timeout: z.coerce.number().optional(),
    workdir: z.string().optional(),
    interactive: z.boolean().optional(),
    description: z.string().optional(),
  })

  test("bash shell style: command + --workdir", async () => {
    const parser = createShellParser(bashSchema)
    const wrapped = shellWrap({ id: "bash", description: "bash", parameters: bashSchema, execute: (args: any) => Effect.succeed({ title: "bash", metadata: {} as any, output: JSON.stringify(args) }) }, parser)
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "ls -la --workdir /src" }, null as any)),
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      // shellWrap 用 XML 包裹输出，检查 JSON 内容
      expect(exit.value.output).toContain('"command"')
      expect(exit.value.output).toContain("ls -la")
      expect(exit.value.output).toContain("/src")
    }
  })

  test("bash shell style: npm install --interactive", async () => {
    const parser = createShellParser(bashSchema)
    const wrapped = shellWrap({ id: "bash", description: "bash", parameters: bashSchema, execute: (args: any) => Effect.succeed({ title: "bash", metadata: {} as any, output: JSON.stringify(args) }) }, parser)
    const exit = await Effect.runPromise(
      Effect.exit(wrapped.execute({ script: "npm install --interactive --description 'Installing deps'" }, null as any)),
    )
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.output).toContain("npm install")
      expect(exit.value.output).toContain("true") // interactive=true
      expect(exit.value.output).toContain("Installing deps")
    }
  })
})

describe("shell-parse-e2e: discriminatedUnion tool (workflow)", () => {
  const runSchema = z.object({
    operation: z.literal("run"),
    name: z.string().optional(),
    script: z.string().optional(),
    async: z.boolean().optional(),
  })
  const statusSchema = z.object({ operation: z.literal("status"), run_id: z.string() })
  const waitSchema = z.object({ operation: z.literal("wait"), run_id: z.string(), timeout_ms: z.number().int().positive().optional() })
  const workflowSchema = z.discriminatedUnion("operation", [runSchema, statusSchema, waitSchema])

  test("workflow run --name deep-research --async", async () => {
    const parser = createShellParser(workflowSchema)
    // 验证 tokenizer 输出
    const argvList = await Effect.runPromise(tokenize("run --name deep-research --async"))
    expect(argvList).toHaveLength(1)
    expect(argvList[0].tokens).toEqual(["run", "--name", "deep-research", "--async"])

    // 验证 parser 输出
    const exit = await Effect.runPromise(Effect.exit(parser.parse("run --name deep-research --async")))
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0]).toMatchObject({ operation: "run", name: "deep-research", async: true })
    }
  })

  test("workflow status <run_id>", async () => {
    const parser = createShellParser(workflowSchema)
    const exit = await Effect.runPromise(Effect.exit(parser.parse("status wf_abc123")))
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value[0]).toEqual({ operation: "status", run_id: "wf_abc123" })
    }
  })
})
