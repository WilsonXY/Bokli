CREATE TABLE `month_close_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`action` text NOT NULL,
	`at` text NOT NULL,
	`reason` text,
	`snapshot` text NOT NULL,
	CONSTRAINT "chk_month_close_events_action" CHECK("month_close_events"."action" IN ('close', 'reopen'))
);
--> statement-breakpoint
CREATE INDEX `ix_month_close_events_month` ON `month_close_events` (`month`);