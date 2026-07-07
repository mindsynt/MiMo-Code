import { Database, eq, sql } from "@/storage"
import { ChunkTable, VectorTable } from "./vectors.sql"

export interface SearchHit {
  chunkId: number
  chunkText: string
  score: number
}

export class VectorIndex {
  private vectors: Float32Array[] = []
  private ids: number[] = []
  private texts: string[] = []
  readonly dims: number

  constructor(dims = 384) {
    this.dims = dims
  }

  load(): void {
    const rows = Database.use((db) =>
      db
        .select({
          chunkId: VectorTable.chunk_id,
          embedding: VectorTable.embedding,
          chunkText: ChunkTable.chunk_text,
        })
        .from(VectorTable)
        .innerJoin(ChunkTable, eq(ChunkTable.id, VectorTable.chunk_id))
        .all(),
    ) as Array<{ chunkId: number; embedding: Uint8Array; chunkText: string }>

    this.vectors = rows.map((r) => new Float32Array(r.embedding.buffer))
    this.ids = rows.map((r) => r.chunkId)
    this.texts = rows.map((r) => r.chunkText)
  }

  get size(): number {
    return this.vectors.length
  }

  add(chunkId: number, embedding: Float32Array, chunkText: string): void {
    Database.use((db) =>
      db
        .insert(VectorTable)
        .values({
          chunk_id: chunkId,
          embedding: Buffer.from(embedding.buffer),
          created_at: Date.now(),
        })
        .run(),
    )
    this.vectors.push(embedding)
    this.ids.push(chunkId)
    this.texts.push(chunkText)
  }

  search(query: Float32Array, topK = 10): SearchHit[] {
    if (this.vectors.length === 0) return []

    const results: Array<{ chunkId: number; chunkText: string; score: number }> = []
    for (let i = 0; i < this.vectors.length; i++) {
      let dot = 0
      for (let j = 0; j < this.dims; j++) {
        dot += query[j] * this.vectors[i][j]
      }
      results.push({ chunkId: this.ids[i], chunkText: this.texts[i], score: dot })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  remove(chunkId: number): void {
    const idx = this.ids.indexOf(chunkId)
    if (idx >= 0) {
      this.vectors.splice(idx, 1)
      this.ids.splice(idx, 1)
      this.texts.splice(idx, 1)
    }
    Database.use((db) => db.delete(VectorTable).where(eq(VectorTable.chunk_id, chunkId)).run())
  }

  clear(): void {
    this.vectors = []
    this.ids = []
    this.texts = []
    Database.use((db) => db.delete(VectorTable).run())
  }
}

let globalIndex: VectorIndex | null = null

export function getVectorIndex(): VectorIndex {
  if (!globalIndex) {
    globalIndex = new VectorIndex()
    globalIndex.load()
  }
  return globalIndex
}

export function resetVectorIndex(): void {
  globalIndex = null
}
