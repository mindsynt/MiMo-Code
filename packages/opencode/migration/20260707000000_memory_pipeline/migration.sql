CREATE TABLE `memory_entity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL UNIQUE,
	`type` text NOT NULL,
	`context` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`source` text DEFAULT 'conversation' NOT NULL,
	`tier` text DEFAULT 'short_term' NOT NULL,
	`first_seen` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_relation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL REFERENCES `memory_entity`(`id`) ON DELETE CASCADE,
	`target_id` integer NOT NULL REFERENCES `memory_entity`(`id`) ON DELETE CASCADE,
	`type` text NOT NULL,
	`weight` real DEFAULT 1.0 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_rel_pair` ON `memory_relation` (`source_id`, `target_id`, `type`);
--> statement-breakpoint
CREATE INDEX `idx_memory_rel_source` ON `memory_relation` (`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_rel_target` ON `memory_relation` (`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_rel_type` ON `memory_relation` (`type`);
--> statement-breakpoint
CREATE TABLE `memory_classify_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tier` text NOT NULL,
	`entities_found` text,
	`processing_ms` integer,
	`created_at` integer NOT NULL
);
