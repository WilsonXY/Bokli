PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cost_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`daily_sheet_id` integer NOT NULL,
	`amount_sen` integer NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`daily_sheet_id`) REFERENCES `daily_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_cost_lines_category" CHECK("__new_cost_lines"."category" IN ('restock','gas','transport','wages-daily','maintenance','other')),
	CONSTRAINT "chk_cost_lines_other_note" CHECK("__new_cost_lines"."category" <> 'other' OR ("__new_cost_lines"."note" IS NOT NULL AND trim("__new_cost_lines"."note", char(32, 9, 10, 11, 12, 13)) <> '')),
	CONSTRAINT "chk_cost_lines_amount_positive" CHECK("__new_cost_lines"."amount_sen" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_cost_lines`("id", "daily_sheet_id", "amount_sen", "category", "note", "created_at") SELECT "id", "daily_sheet_id", "amount_sen", "category", "note", "created_at" FROM `cost_lines`;--> statement-breakpoint
-- Carry the AUTOINCREMENT high-water mark over so deleted ids are never reused.
UPDATE sqlite_sequence SET seq = (SELECT max(seq) FROM sqlite_sequence WHERE name IN ('cost_lines', '__new_cost_lines')) WHERE name = '__new_cost_lines';--> statement-breakpoint
INSERT INTO sqlite_sequence(name, seq) SELECT '__new_cost_lines', seq FROM sqlite_sequence WHERE name = 'cost_lines' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__new_cost_lines');--> statement-breakpoint
DROP TABLE `cost_lines`;--> statement-breakpoint
ALTER TABLE `__new_cost_lines` RENAME TO `cost_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_cost_lines_sheet` ON `cost_lines` (`daily_sheet_id`);--> statement-breakpoint
CREATE TABLE `__new_month_closes` (
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
	`reopen_reason` text,
	CONSTRAINT "chk_month_closes_cash_on_hand_nonneg" CHECK("__new_month_closes"."cash_on_hand_sen" IS NULL OR "__new_month_closes"."cash_on_hand_sen" >= 0),
	CONSTRAINT "chk_month_closes_tng_on_hand_nonneg" CHECK("__new_month_closes"."tng_on_hand_sen" IS NULL OR "__new_month_closes"."tng_on_hand_sen" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_month_closes`("id", "month", "revenue_sen", "daily_cost_sen", "gross_sen", "operating_sen", "net_sen", "cash_on_hand_sen", "tng_on_hand_sen", "note", "closed_at", "reopened_at", "reopen_reason") SELECT "id", "month", "revenue_sen", "daily_cost_sen", "gross_sen", "operating_sen", "net_sen", "cash_on_hand_sen", "tng_on_hand_sen", "note", "closed_at", "reopened_at", "reopen_reason" FROM `month_closes`;--> statement-breakpoint
-- Carry the AUTOINCREMENT high-water mark over so deleted ids are never reused.
UPDATE sqlite_sequence SET seq = (SELECT max(seq) FROM sqlite_sequence WHERE name IN ('month_closes', '__new_month_closes')) WHERE name = '__new_month_closes';--> statement-breakpoint
INSERT INTO sqlite_sequence(name, seq) SELECT '__new_month_closes', seq FROM sqlite_sequence WHERE name = 'month_closes' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__new_month_closes');--> statement-breakpoint
DROP TABLE `month_closes`;--> statement-breakpoint
ALTER TABLE `__new_month_closes` RENAME TO `month_closes`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_month_closes_month` ON `month_closes` (`month`);--> statement-breakpoint
CREATE TABLE `__new_operating_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`type` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_opex_type" CHECK("__new_operating_expenses"."type" IN ('rental','utilities','wages','other')),
	CONSTRAINT "chk_opex_other_note" CHECK("__new_operating_expenses"."type" <> 'other' OR ("__new_operating_expenses"."note" IS NOT NULL AND trim("__new_operating_expenses"."note", char(32, 9, 10, 11, 12, 13)) <> '')),
	CONSTRAINT "chk_opex_amount_nonneg" CHECK("__new_operating_expenses"."amount_sen" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_operating_expenses`("id", "month", "type", "amount_sen", "note", "created_at", "updated_at") SELECT "id", "month", "type", "amount_sen", "note", "created_at", "updated_at" FROM `operating_expenses`;--> statement-breakpoint
-- Carry the AUTOINCREMENT high-water mark over so deleted ids are never reused.
UPDATE sqlite_sequence SET seq = (SELECT max(seq) FROM sqlite_sequence WHERE name IN ('operating_expenses', '__new_operating_expenses')) WHERE name = '__new_operating_expenses';--> statement-breakpoint
INSERT INTO sqlite_sequence(name, seq) SELECT '__new_operating_expenses', seq FROM sqlite_sequence WHERE name = 'operating_expenses' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__new_operating_expenses');--> statement-breakpoint
DROP TABLE `operating_expenses`;--> statement-breakpoint
ALTER TABLE `__new_operating_expenses` RENAME TO `operating_expenses`;--> statement-breakpoint
CREATE INDEX `ix_operating_expenses_month` ON `operating_expenses` (`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_opex_month_type_note` ON `operating_expenses` (`month`,`type`,`note`) WHERE "operating_expenses"."note" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_opex_month_type_null_note` ON `operating_expenses` (`month`,`type`) WHERE "operating_expenses"."note" IS NULL;