import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@mimo-ai/sdk/v2/client"

export const SESSION_CACHE_LIMIT = 40

type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_diff: Record<string, SnapshotFileDiff[] | undefined>
  session_goal: Record<string, unknown | undefined>
  session_cwd: Record<string, string | undefined>
  todo: Record<string, Todo[] | undefined>
  task: Record<string, unknown[] | undefined>
  actor: Record<string, unknown[] | undefined>
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    delete store.part[key]
  }

  for (const sessionID of stale) {
    delete store.message[sessionID]
    // 保留 todo 数据：当 session 因裁剪而被清除时，其任务仍应在任务标签中显示，
    // 不应被自动删除。只有 session 被归档时才需要通过 cleanupSessionCaches 清理。
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.session_goal[sessionID]
    delete store.session_cwd[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
    delete store.task[sessionID]
    delete store.actor[sessionID]
  }
}

export function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
  preserve?: Iterable<string>
}) {
  const stale: string[] = []
  const keep = new Set([input.keep, ...Array.from(input.preserve ?? [])])
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (keep.has(id)) continue
    stale.push(id)
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}
