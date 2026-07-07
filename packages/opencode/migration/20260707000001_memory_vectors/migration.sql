CREATE TABLE `memory_chunk` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `chunk_text` text NOT NULL,
  `entity_id` integer,
  `source` text DEFAULT 'conversation' NOT NULL,
  `tier` text DEFAULT 'short_term' NOT NULL,
  `ttl` integer,
  `created_at` integer NOT NULL,
  `last_accessed` integer
);
--> statement-breakpoint
CREATE INDEX `idx_memory_chunk_entity` ON `memory_chunk` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_chunk_tier` ON `memory_chunk` (`tier`);
--> statement-breakpoint
CREATE TABLE `memory_vector` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `chunk_id` integer NOT NULL UNIQUE REFERENCES `memory_chunk`(`id`) ON DELETE CASCADE,
  `embedding` blob NOT NULL,
  `created_at` integer NOT NULL
);
