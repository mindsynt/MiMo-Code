const API_BASE = (typeof window !== "undefined" && import.meta.env?.VITE_API_URL) || ""

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

export interface SessionData {
  sessionID: string
  messages: Array<{
    id: string
    role: "user" | "assistant"
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  }>
}

/** 获取会话数据 */
export function fetchSession(id: string) {
  return api<{ info?: Record<string, unknown>; messages: Record<string, unknown> }>(`/share_data?id=${id}`)
}

/** 发送消息 */
export function sendMessage(sessionID: string, text: string) {
  return api<{ messageID: string }>(`/session/${sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text, parts: [] }),
  })
}

/** 中止生成 */
export function abortSession(sessionID: string) {
  return api<{ ok: boolean }>(`/session/${sessionID}/abort`, { method: "POST" })
}

/** 分享会话 */
export function shareSession(sessionID: string) {
  return api<{ url: string }>(`/session/${sessionID}/share`, { method: "POST" })
}

/** 取消分享 */
export function unshareSession(sessionID: string) {
  return api<{ ok: boolean }>(`/session/${sessionID}/unshare`, { method: "POST" })
}

/** 重命名会话 */
export function renameSession(sessionID: string, title: string) {
  return api<{ ok: boolean }>(`/session/${sessionID}/rename`, {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

/** 撤销到指定消息 */
export function revertSession(sessionID: string, messageID: string) {
  return api<{ ok: boolean }>(`/session/${sessionID}/revert`, {
    method: "POST",
    body: JSON.stringify({ messageID }),
  })
}
