CREATE TABLE `cloud_operation_receipts` (
	`actor_user_id` integer NOT NULL,
	`operation` text NOT NULL,
	`operation_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempt_token` text NOT NULL,
	`status` integer,
	`result` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`actor_user_id`, `operation`, `operation_id`),
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cloud_receipt_result" CHECK(("cloud_operation_receipts"."result" IS NULL AND "cloud_operation_receipts"."status" IS NULL) OR ("cloud_operation_receipts"."result" IS NOT NULL AND json_valid("cloud_operation_receipts"."result") AND "cloud_operation_receipts"."status" IN (200,201))),
	CONSTRAINT "chk_cloud_receipt_key" CHECK(length("cloud_operation_receipts"."operation_id") BETWEEN 1 AND 200),
	CONSTRAINT "chk_cloud_receipt_operation" CHECK("cloud_operation_receipts"."operation" IN ('sheet.save','sheet.delete','expense.add','expense.delete','month.close','month.reopen'))
);
--> statement-breakpoint
CREATE TABLE `cloud_write_guard` (
	`id` integer PRIMARY KEY NOT NULL,
	`maintenance` integer DEFAULT 0 NOT NULL,
	`check_code` text,
	CONSTRAINT "chk_cloud_guard_singleton" CHECK("cloud_write_guard"."id"=1 AND "cloud_write_guard"."maintenance" IN (0,1) AND "cloud_write_guard"."check_code" IS NULL)
);
--> statement-breakpoint
CREATE TABLE `legacy_expense_receipt_owners` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`actor_user_id` integer NOT NULL,
	FOREIGN KEY (`idempotency_key`) REFERENCES `operating_expense_add_requests`(`idempotency_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `month_close_events` ADD `actor_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `month_close_events` ADD `actor_role` text;--> statement-breakpoint
INSERT INTO cloud_write_guard(id) VALUES (1);
--> statement-breakpoint
CREATE TRIGGER cloud_guard_check BEFORE UPDATE OF check_code ON cloud_write_guard BEGIN
 SELECT CASE NEW.check_code
 WHEN 'BOKLI_MAINTENANCE' THEN RAISE(ABORT,'BOKLI_MAINTENANCE')
 WHEN 'BOKLI_FORBIDDEN' THEN RAISE(ABORT,'BOKLI_FORBIDDEN')
 WHEN 'BOKLI_MONEY_RANGE' THEN RAISE(ABORT,'BOKLI_MONEY_RANGE')
 WHEN 'BOKLI_EXPENSE_OVERFLOW' THEN RAISE(ABORT,'BOKLI_EXPENSE_OVERFLOW')
 WHEN 'BOKLI_NOT_FOUND' THEN RAISE(ABORT,'BOKLI_NOT_FOUND')
 WHEN 'BOKLI_SHEET_CHANGED' THEN RAISE(ABORT,'BOKLI_SHEET_CHANGED')
 WHEN 'BOKLI_MONTH_LOCKED' THEN RAISE(ABORT,'BOKLI_MONTH_LOCKED')
 WHEN 'BOKLI_ALREADY_OPEN' THEN RAISE(ABORT,'BOKLI_ALREADY_OPEN')
 WHEN 'BOKLI_STALE_CLOSE' THEN RAISE(ABORT,'BOKLI_STALE_CLOSE')
 WHEN 'BOKLI_EMPTY_MONTH' THEN RAISE(ABORT,'BOKLI_EMPTY_MONTH')
 WHEN 'BOKLI_VARIANCE_NOTE' THEN RAISE(ABORT,'BOKLI_VARIANCE_NOTE')
 WHEN 'BOKLI_LEGACY_SCOPE' THEN RAISE(ABORT,'BOKLI_LEGACY_SCOPE')
 WHEN 'BOKLI_OPERATION_CONFLICT' THEN RAISE(ABORT,'BOKLI_OPERATION_CONFLICT')
 WHEN 'BOKLI_RESULT_MISSING' THEN RAISE(ABORT,'BOKLI_RESULT_MISSING') END;
END;
--> statement-breakpoint
CREATE TRIGGER cloud_guard_no_delete BEFORE DELETE ON cloud_write_guard BEGIN SELECT RAISE(ABORT,'BOKLI_GUARD_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER cloud_guard_no_replace BEFORE INSERT ON cloud_write_guard WHEN EXISTS(SELECT 1 FROM cloud_write_guard) BEGIN SELECT RAISE(ABORT,'BOKLI_GUARD_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER cloud_receipt_gate BEFORE INSERT ON cloud_operation_receipts WHEN NOT EXISTS(SELECT 1 FROM cloud_write_guard WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT,'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER cloud_receipt_immutable_update BEFORE UPDATE ON cloud_operation_receipts WHEN OLD.result IS NOT NULL OR NEW.actor_user_id<>OLD.actor_user_id OR NEW.operation<>OLD.operation OR NEW.operation_id<>OLD.operation_id OR NEW.payload<>OLD.payload OR NEW.attempt_token<>OLD.attempt_token OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER cloud_receipt_immutable_delete BEFORE DELETE ON cloud_operation_receipts BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER cloud_receipt_no_replace BEFORE INSERT ON cloud_operation_receipts WHEN EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE actor_user_id=NEW.actor_user_id AND operation=NEW.operation AND operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_receipt_owner_immutable_update BEFORE UPDATE ON legacy_expense_receipt_owners BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_receipt_owner_immutable_delete BEFORE DELETE ON legacy_expense_receipt_owners BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_receipt_owner_no_replace BEFORE INSERT ON legacy_expense_receipt_owners WHEN EXISTS(SELECT 1 FROM legacy_expense_receipt_owners WHERE idempotency_key=NEW.idempotency_key) BEGIN SELECT RAISE(ABORT,'BOKLI_RECEIPT_IMMUTABLE'); END;
