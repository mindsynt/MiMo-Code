CREATE TABLE `memory_rule_provenance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_name` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`extracted_text` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_prov_rule` ON `memory_rule_provenance` (`rule_name`);
--> statement-breakpoint
CREATE INDEX `idx_rule_prov_session` ON `memory_rule_provenance` (`session_id`);
