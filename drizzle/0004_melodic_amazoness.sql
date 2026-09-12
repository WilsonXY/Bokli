CREATE TABLE `login_attempts` (
	`username_lower` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_updated_at` ON `login_attempts` (`updated_at`);
