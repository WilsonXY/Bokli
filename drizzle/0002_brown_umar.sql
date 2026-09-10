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
	CONSTRAINT "chk_cost_lines_other_note" CHECK("__new_cost_lines"."category" <> 'other' OR "__new_cost_lines"."note" IS NOT NULL),
	CONSTRAINT "chk_cost_lines_amount_nonneg" CHECK("__new_cost_lines"."amount_sen" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_cost_lines`("id", "daily_sheet_id", "amount_sen", "category", "note", "created_at") SELECT "id", "daily_sheet_id", "amount_sen", "category", "note", "created_at" FROM `cost_lines`;--> statement-breakpoint
DROP TABLE `cost_lines`;--> statement-breakpoint
ALTER TABLE `__new_cost_lines` RENAME TO `cost_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_cost_lines_sheet` ON `cost_lines` (`daily_sheet_id`);