CREATE TABLE `cost_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`daily_sheet_id` integer NOT NULL,
	`amount_sen` integer NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`daily_sheet_id`) REFERENCES `daily_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_cost_lines_category" CHECK("cost_lines"."category" IN ('restock','gas','transport','wages-daily','other')),
	CONSTRAINT "chk_cost_lines_other_note" CHECK("cost_lines"."category" <> 'other' OR "cost_lines"."note" IS NOT NULL),
	CONSTRAINT "chk_cost_lines_amount_nonneg" CHECK("cost_lines"."amount_sen" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_cost_lines_sheet` ON `cost_lines` (`daily_sheet_id`);--> statement-breakpoint
CREATE TABLE `daily_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`cash_sen` integer DEFAULT 0 NOT NULL,
	`tng_sen` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_daily_sheets_cash_nonneg" CHECK("daily_sheets"."cash_sen" >= 0),
	CONSTRAINT "chk_daily_sheets_tng_nonneg" CHECK("daily_sheets"."tng_sen" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_daily_sheets_date` ON `daily_sheets` (`date`);--> statement-breakpoint
CREATE TABLE `month_closes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`revenue_sen` integer NOT NULL,
	`daily_cost_sen` integer NOT NULL,
	`gross_sen` integer NOT NULL,
	`operating_sen` integer NOT NULL,
	`net_sen` integer NOT NULL,
	`cash_on_hand_sen` integer,
	`tng_on_hand_sen` integer,
	`note` text,
	`closed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reopened_at` text,
	`reopen_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_month_closes_month` ON `month_closes` (`month`);--> statement-breakpoint
CREATE TABLE `operating_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`type` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_opex_type" CHECK("operating_expenses"."type" IN ('rental','utilities','wages','other')),
	CONSTRAINT "chk_opex_amount_nonneg" CHECK("operating_expenses"."amount_sen" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_operating_expenses_month` ON `operating_expenses` (`month`);