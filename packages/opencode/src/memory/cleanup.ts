import { Database, lt, eq, and, or } from "@/storage"
import { sql } from "drizzle-orm"
import { ChunkTable, VectorTable } from "./vectors.sql"
import { Log } from "../util"

const log = Log.create({ service: "memory.cleanup" })

/**
 * Tier-aware cleanup:
 * - core entities: 永不删除
 * - stable entities: 长 TTL（由 ttl 列控制）
 * - ephemeral entities: 短 TTL（由 ttl 列控制）
 *
 * Chunks without a tier column default to short_term — they get the
 * existing TTL-based treatment.
 */
export function cleanupExpired(): { expiredChunks: number; expiredVectors: number } {
  const now = Date.now()

  // Delete expired chunks (short_term + past TTL)
  // Note: persistent/core chunks have ttl = null, so they're never matched
  const expiredChunks = Database.use((db) =>
    db
      .delete(ChunkTable)
      .where(and(lt(ChunkTable.ttl, now), eq(ChunkTable.tier, "short_term")))
      .run(),
  ) as any

  // Cascade delete should handle vectors, but clean orphans just in case
  const expiredVectors = Database.use((db) =>
    db
      .delete(VectorTable)
      .where(sql`memory_vector.chunk_id NOT IN (SELECT id FROM memory_chunk)`)
      .run(),
  ) as any

  const result = {
    expiredChunks: expiredChunks.changes ?? 0,
    expiredVectors: (expiredVectors as any)?.changes ?? 0,
  }

  if (result.expiredChunks > 0 || result.expiredVectors > 0) {
    log.info("cleanup completed", result)
  }

  return result
}
