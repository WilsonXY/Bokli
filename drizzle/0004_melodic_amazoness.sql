CREATE TABLE `login_attempts` (
	`username_lower` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
