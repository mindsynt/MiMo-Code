CREATE TABLE `memory_user_profile` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL UNIQUE,
  `value` text NOT NULL,
  `category` text NOT NULL,
  `confidence` real DEFAULT 0.5 NOT NULL,
  `source` text DEFAULT 'conversation' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
