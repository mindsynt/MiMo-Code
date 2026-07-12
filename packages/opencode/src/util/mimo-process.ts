export const MIMOCODE_RUN_ID = "MIMOCODE_RUN_ID"
export const MIMOCODE_PROCESS_ROLE = "MIMOCODE_PROCESS_ROLE"

/** 安全环境变量白名单——仅传递这些变量给子进程，防止凭据泄露 */
const SAFE_ENV_VARS = new Set([
  "PATH", "HOME", "SHELL", "USER", "USERNAME",
  "PWD", "OLDPWD", "TERM", "LANG", "LC_ALL",
  "TMPDIR", "TMP", "TEMPDIR",
  "NODE_PATH", "BUN_RUNTIME",
  "PYTHONIOENCODING",
  MIMOCODE_RUN_ID, MIMOCODE_PROCESS_ROLE,
])

export function ensureRunID() {
  return (process.env[MIMOCODE_RUN_ID] ??= crypto.randomUUID())
}

export function ensureProcessRole(fallback: "main" | "worker") {
  return (process.env[MIMOCODE_PROCESS_ROLE] ??= fallback)
}

export function ensureProcessMetadata(fallback: "main" | "worker") {
  return {
    runID: ensureRunID(),
    processRole: ensureProcessRole(fallback),
  }
}

export function sanitizedProcessEnv(overrides?: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return overrides ? Object.assign(env, overrides) : env
}

/** 仅保留白名单中的安全环境变量，用于传递给不可信任的子进程 */
export function minimalProcessEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_VARS) {
    const val = process.env[key]
    if (val !== undefined) env[key] = val
  }
  // 保留 MIMOCODE_ 前缀的内部变量（MIMOCODE_RUN_ID 等已被 SAFE_ENV_VARS 覆盖）
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined && key.startsWith("MIMOCODE_") && !(key in env)) {
      env[key] = val
    }
  }
  return overrides ? { ...env, ...overrides } : env
}
