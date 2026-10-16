CREATE TABLE `user_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_user_emails_normalized" CHECK("user_emails"."email" = lower(trim("user_emails"."email")) AND length("user_emails"."email") <= 254 AND "user_emails"."email" NOT GLOB '*[^!-~]*' AND "user_emails"."email" GLOB '?*@?*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_emails_user` ON `user_emails` (`user_id`);