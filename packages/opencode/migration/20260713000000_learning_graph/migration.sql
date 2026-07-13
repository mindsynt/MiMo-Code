CREATE TABLE IF NOT EXISTS `learning_node` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `kind` text NOT NULL,
  `category` text DEFAULT '',
  `use_count` integer DEFAULT 0,
  `state` text DEFAULT 'active',
  `bundled` integer DEFAULT 0,
  `timestamp` integer,
  `memory_source` text,
  `fingerprint` text NOT NULL DEFAULT '',
  `last_built_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `learning_edge` (
  `source` text NOT NULL REFERENCES `learning_node`(`id`) ON DELETE CASCADE,
  `target` text NOT NULL REFERENCES `learning_node`(`id`) ON DELETE CASCADE,
  `weight` real NOT NULL DEFAULT 0,
  `edge_type` text NOT NULL DEFAULT 'skill-skill',
  `last_built_at` integer NOT NULL,
  PRIMARY KEY (`source`, `target`, `edge_type`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `learning_node_kind_idx` ON `learning_node` (`kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `learning_edge_source_idx` ON `learning_edge` (`source`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `learning_edge_target_idx` ON `learning_edge` (`target`);
