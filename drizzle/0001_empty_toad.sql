CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_users_role" CHECK("users"."role" IN ('Operator', 'Admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_username` ON `users` (`username`);