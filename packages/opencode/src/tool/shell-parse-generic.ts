import z from "zod"
import { Effect } from "effect"
import { tokenize, type Argv, type ParseError } from "./shell-tokenize"

/**
 * 映射规则：解析 shell 令牌序列为 zod schema 对象。
 */
function tokensToObject(tokens: string[], schema: z.ZodTypeAny, excludeKeys?: Set<string>): Record<string, unknown> {
  // 处理 discriminatedUnion → 首 token 为 discriminator 值
  if (schema.constructor.name === "ZodDiscriminatedUnion") {
    const du = schema as any
    const discKey: string = du._def.discriminator
    const discValue = tokens[0]
    if (!discValue || discValue.startsWith("--")) {
      throw new Error(`missing discriminator value, expected one of the union options`)
    }
    const options: z.ZodObject<any>[] = du._def.options
    const matched = options.find((opt) => opt.shape[discKey]?.value === discValue)
    if (!matched) {
      const available = options.map((opt) => opt.shape[discKey]?.value).filter(Boolean)
      throw new Error(`unknown discriminator "${discValue}", expected: ${available.join(" | ")}`)
    }
    // 父层已设置 discriminator 值，子映射中不应再包含该键
    const inner = tokensToObject(tokens.slice(1), matched, new Set([discKey]))
    inner[discKey] = discValue
    return inner
  }

  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`unsupported schema type for shell parsing: ${schema.constructor.name}`)
  }

  const shape: Record<string, z.ZodTypeAny> = schema.shape
  const keys = Object.keys(shape).filter((k) => !excludeKeys?.has(k))
  if (keys.length === 0) return {}

  // 分离位置参数和 --flag 参数
  const positional: string[] = []
  const flags: Map<string, string> = new Map()
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.startsWith("--")) {
      const flagName = t.slice(2)
      // 查找该 flag 对应的 schema 字段类型
      const targetKey = matchFlagToKey(flagName, keys)
      const fieldType = targetKey ? shape[targetKey]?.constructor?.name : undefined
      const isBool = fieldType === "ZodBoolean"
      if (isBool) {
        // Boolean flag: --flag (无值) = true, --flag true/false 也行
        flags.set(flagName, "true")
        i++
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
        flags.set(flagName, tokens[i + 1])
        i += 2
      } else {
        flags.set(flagName, "")
        i++
      }
    } else {
      positional.push(t)
      i++
    }
  }

  // 分离 required 和 optional keys
  const requiredKeys: string[] = []
  const optionalKeys: string[] = []
  for (const key of keys) {
    const field = shape[key]
    if (field.isOptional() || field instanceof z.ZodOptional || field instanceof z.ZodDefault) {
      optionalKeys.push(key)
    } else {
      requiredKeys.push(key)
    }
  }

  // 位置参数 → required 字段（按 schema key 顺序）
  const result: Record<string, unknown> = {}
  let pi = 0
  // 先映射到已声明的 required 字段
  while (pi < positional.length && pi < requiredKeys.length) {
    result[requiredKeys[pi]] = coerceToken(positional[pi], shape[requiredKeys[pi]])
    pi++
  }
  // 剩余未匹配的位置参数拼接到最后一个 string 字段
  if (pi < positional.length) {
    const stringKeys = requiredKeys.filter((k) => shape[k]?.constructor?.name === "ZodString")
    const lastString = stringKeys[stringKeys.length - 1]
    // 也检查 optional string 字段
    const optStringKeys = optionalKeys.filter((k) => shape[k]?.constructor?.name === "ZodString" || coerceIsString(shape[k]))
    if (lastString && typeof result[lastString] === "string") {
      const assigned = result[lastString] as string; result[lastString] = assigned + " " + positional.slice(pi).join(" ")
      pi = positional.length
    } else if (optStringKeys.length > 0) {
      // 取第一个可选 string 字段
      const firstOpt = optStringKeys[0]
      result[firstOpt] = positional.slice(pi).join(" ")
      pi = positional.length
    }
  }

  // --flag → 可选字段
  for (const [flagName, rawValue] of flags) {
    // 支持驼峰和 kebab-case 匹配（--file-path → filePath）
    let key = matchFlagToKey(flagName, keys)
    if (!key) {
      // 尝试直接作为 key
      if (keys.includes(flagName)) key = flagName
    }
    if (key && shape[key]) {
      result[key] = coerceToken(rawValue, shape[key])
    }
  }

  return result
}

/** --flag-val → filePath 等映射 */
function matchFlagToKey(flag: string, keys: string[]): string | undefined {
  // 精确匹配
  if (keys.includes(flag)) return flag

  // kebab-case → camelCase: --file-path → filePath
  const camel = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  if (keys.includes(camel)) return camel

  // 下划线式: --file-path → file_path
  const underscore = flag.replace(/-/g, "_")
  if (keys.includes(underscore)) return underscore

  // 模糊匹配（忽略大小写、分隔符）
  const normalized = flag.replace(/[-_]/g, "").toLowerCase()
  for (const key of keys) {
    if (key.replace(/[-_]/g, "").toLowerCase() === normalized) return key
  }

  return undefined
}

/** 判断字段 schema 是否最终解析为 string */
function coerceIsString(field: z.ZodTypeAny): boolean {
  const name = field.constructor.name
  if (name === "ZodString") return true
  if (name === "ZodOptional" || name === "ZodDefault") {
    const inner = (field as any)._def?.innerType
    return inner ? coerceIsString(inner) : false
  }
  return false
}

/** 将字符串 tokens 转换为字段 schema 要求的类型 */
function coerceToken(value: string, fieldSchema: z.ZodTypeAny): unknown {
  const typeName = fieldSchema.constructor.name

  if (typeName === "ZodString") return value

  if (typeName === "ZodNumber" || typeName === "ZodDefault") {
    // 检查是否为数字类型的 default
    const innerType = typeName === "ZodDefault" ? (fieldSchema as any)._def?.innerType : undefined
    if (typeName === "ZodDefault" && innerType?.constructor?.name !== "ZodNumber") return value
    const n = Number(value)
    return n
  }

  if (typeName === "ZodBoolean") {
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
    return true // --flag 无值已经返回 true
  }

  if (typeName === "ZodEnum") {
    // Zod 4: enum values in .options; Zod 3: in ._def.values
    const values: string[] = (fieldSchema as any).options ?? (fieldSchema as any)._def?.values
    if (!values || !Array.isArray(values)) return value
    // 精确匹配
    if (values.includes(value)) return value
    // 模糊匹配
    const lower = value.toLowerCase()
    for (const v of values) {
      if (v.toLowerCase() === lower) return v
    }
    throw new Error(`expected one of [${values.join(", ")}], got "${value}"`)
  }

  // ZodArray / ZodObject → JSON 解码
  if (typeName === "ZodArray" || typeName === "ZodObject") {
    try {
      return JSON.parse(value)
    } catch {
      throw new Error(`expected JSON value for complex field, got "${value.slice(0, 50)}..."`)
    }
  }

  // ZodDefault: unwrap and coerce
  if (typeName === "ZodDefault") {
    return coerceToken(value, (fieldSchema as any)._def.innerType)
  }

  // ZodOptional: unwrap
  if (typeName === "ZodOptional") {
    return coerceToken(value, (fieldSchema as any)._def.innerType)
  }

  return value
}

/** 从 schema 自动生成 shell 语法描述文字 */
export function autoShellDescription(schema: z.ZodTypeAny, toolId: string): string {
  if (schema.constructor.name === "ZodDiscriminatedUnion") {
    const du = schema as any
    const discKey: string = du._def.discriminator
    const options: z.ZodObject<any>[] = du._def.options
    const lines: string[] = []
    for (const opt of options) {
      const discVal = opt.shape[discKey]?.value ?? "?"
      const subSyntax = describeObjectSyntax(opt, "")
      lines.push(`    ${toolId} ${discVal}${subSyntax}`)
    }
    return lines.join("\n")
  }

  if (schema instanceof z.ZodObject) {
    const syntax = describeObjectSyntax(schema, "")
    const lines = [`    ${toolId}${syntax}`]
    // 为所有工具添加通用负面示例提示
    lines.push("")
    lines.push("# WRONG — JSON-style fields directly (no `script` key) will fail:")
    lines.push(`#   {"${Object.keys(schema.shape)[0]}":"..."}  ✗`)
    lines.push("# RIGHT — use the shell syntax above inside `script`:")
    lines.push(`#   ${toolId} ...   ✓`)
    return lines.join("\n")
  }

  return `    ${toolId} <args>`
}

function describeObjectSyntax(schema: z.ZodObject<any>, _prefix: string): string {
  const shape = schema.shape
  const keys = Object.keys(shape)
  const parts: string[] = []

  for (const key of keys) {
    const field = shape[key]
    const isOpt = field.isOptional() || field instanceof z.ZodOptional || field instanceof z.ZodDefault
    const typeName = field.constructor.name

    // 跳过内部字段
    if (key === "operation" || key === "action") continue

    let valStr = "<val>"
    if (typeName === "ZodString") valStr = "<text>"
    else if (typeName === "ZodNumber") valStr = "<n>"
    else if (typeName === "ZodBoolean") valStr = ""
    else if (typeName === "ZodEnum") {
      const values: string[] = (field as any)._def.values ?? []
      valStr = values.join("|")
    } else if (typeName === "ZodArray" || typeName === "ZodObject") {
      valStr = "'<json>'"
    }

    const flagName = isOpt ? `--${key.replace(/_/g, "-")} ` : ""
    const display = isOpt ? `[${flagName}${valStr}]` : `<${key}>` + (valStr !== "<text>" ? ` ${valStr}` : "")
    parts.push(display)
  }

  return parts.length > 0 ? " " + parts.join(" ") : ""
}

/**
 * 通用 shell 脚本解析器。解析 script 为 schema 对象数组。
 * 每条非空行 = 一个命令，按行拆分为独立调用。
 */
export function createShellParser(parameters: z.ZodTypeAny): {
  parse(script: string): Effect.Effect<any[], ParseError>
  description: string
  recover?(rawArgs: unknown): any | undefined
} {
  const schema = parameters

  return {
    description: autoShellDescription(schema, ""),

    recover(rawArgs: unknown): any | undefined {
      if (rawArgs == null || typeof rawArgs !== "object") return undefined
      try {
        return schema.parse(rawArgs)
      } catch {
        return undefined
      }
    },

    parse: (script: string) =>
      Effect.suspend(() => {
        if (script.trim() === "") return Effect.succeed([] as any[])

        return Effect.gen(function* () {
          const argvList: Argv[] = yield* tokenize(script)
          const out: any[] = []

          for (const argv of argvList) {
            if (argv.tokens.length === 0) continue
            try {
              const obj = tokensToObject(argv.tokens, schema)
              // Zod 完整校验
              const validated = schema.parse(obj)
              out.push(validated)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              return yield* Effect.fail<ParseError>({
                kind: "internal",
                line: argv.line,
                detail: msg,
              })
            }
          }

          return out
        })
      }),
  }
}
