-- Expansion only: bootstrap imports the frozen 0000-0008 baseline before this file.
UPDATE month_closes SET reopened_at = NULL WHERE reopened_at = '';
--> statement-breakpoint
CREATE TRIGGER month_closes_reopened_insert BEFORE INSERT ON month_closes
WHEN NEW.reopened_at = ''
BEGIN SELECT RAISE(ABORT, 'BOKLI_EMPTY_REOPENED_AT'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_reopened_update BEFORE UPDATE ON month_closes
WHEN NEW.reopened_at = ''
BEGIN SELECT RAISE(ABORT, 'BOKLI_EMPTY_REOPENED_AT'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_month_lock_insert BEFORE INSERT ON daily_sheets
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=substr(NEW.date,1,7) AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_month_lock_update BEFORE UPDATE ON daily_sheets
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=substr(OLD.date,1,7) AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM month_closes WHERE month=substr(NEW.date,1,7) AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM daily_sheets r JOIN month_closes m ON m.month=substr(r.date,1,7) WHERE r.id=NEW.id AND r.id<>OLD.id AND (m.reopened_at IS NULL OR m.reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_month_lock_delete BEFORE DELETE ON daily_sheets
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=substr(OLD.date,1,7) AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_month_lock_insert BEFORE INSERT ON cost_lines
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=(SELECT substr(date,1,7) FROM daily_sheets WHERE id=NEW.daily_sheet_id) AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_month_lock_update BEFORE UPDATE ON cost_lines
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=(SELECT substr(date,1,7) FROM daily_sheets WHERE id=OLD.daily_sheet_id) AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM month_closes WHERE month=(SELECT substr(date,1,7) FROM daily_sheets WHERE id=NEW.daily_sheet_id) AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM cost_lines c JOIN daily_sheets d ON d.id=c.daily_sheet_id JOIN month_closes m ON m.month=substr(d.date,1,7) WHERE c.id=NEW.id AND c.id<>OLD.id AND (m.reopened_at IS NULL OR m.reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_month_lock_delete BEFORE DELETE ON cost_lines
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=(SELECT substr(date,1,7) FROM daily_sheets WHERE id=OLD.daily_sheet_id) AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_month_lock_insert BEFORE INSERT ON operating_expenses
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=NEW.month AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_month_lock_update BEFORE UPDATE ON operating_expenses
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=OLD.month AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM month_closes WHERE month=NEW.month AND (reopened_at IS NULL OR reopened_at='')) OR EXISTS (SELECT 1 FROM operating_expenses r JOIN month_closes m ON m.month=r.month WHERE r.id=NEW.id AND r.id<>OLD.id AND (m.reopened_at IS NULL OR m.reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_month_lock_delete BEFORE DELETE ON operating_expenses
WHEN EXISTS (SELECT 1 FROM month_closes WHERE month=OLD.month AND (reopened_at IS NULL OR reopened_at=''))
BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_month_lock_replace BEFORE INSERT ON daily_sheets WHEN EXISTS (SELECT 1 FROM daily_sheets r JOIN month_closes m ON m.month=substr(r.date,1,7) WHERE (r.id=NEW.id OR r.date=NEW.date) AND (m.reopened_at IS NULL OR m.reopened_at='')) BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_month_lock_replace BEFORE INSERT ON operating_expenses WHEN EXISTS (SELECT 1 FROM operating_expenses r JOIN month_closes m ON m.month=r.month WHERE (r.id=NEW.id) AND (m.reopened_at IS NULL OR m.reopened_at='')) BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_month_lock_replace BEFORE INSERT ON cost_lines WHEN EXISTS (SELECT 1 FROM cost_lines c JOIN daily_sheets d ON d.id=c.daily_sheet_id JOIN month_closes m ON m.month=substr(d.date,1,7) WHERE c.id=NEW.id AND (m.reopened_at IS NULL OR m.reopened_at='')) BEGIN SELECT RAISE(ABORT, 'BOKLI_MONTH_LOCKED'); END;
--> statement-breakpoint
CREATE TABLE `user_email_identities` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_identity_email_normalized" CHECK("user_email_identities"."email" <> '' AND "user_email_identities"."email" = lower(trim("user_email_identities"."email", char(32,9,10,11,12,13))))
);
--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`user_id` integer NOT NULL,
	`operation` text NOT NULL,
	`operation_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` integer NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `operation`, `operation_id`),
	CONSTRAINT "chk_receipt_user" CHECK("mutation_receipts"."user_id" > 0),
	CONSTRAINT "chk_receipt_operation" CHECK("mutation_receipts"."operation" IN ('save-sheet','delete-sheets','expense-add','delete-expenses','close-month','reopen-month')),
	CONSTRAINT "chk_receipt_id" CHECK(("mutation_receipts"."operation_id" IS NOT NULL AND trim("mutation_receipts"."operation_id", char(32, 9, 10, 11, 12, 13)) <> '')),
	CONSTRAINT "chk_receipt_payload" CHECK(json_valid("mutation_receipts"."payload")),
	CONSTRAINT "chk_receipt_status" CHECK("mutation_receipts"."status" BETWEEN 200 AND 299),
	CONSTRAINT "chk_receipt_result" CHECK(json_valid("mutation_receipts"."result"))
);
--> statement-breakpoint
ALTER TABLE `month_close_events` ADD `actor_user_id` integer;
--> statement-breakpoint
ALTER TABLE `month_close_events` ADD `actor_role` text;
--> statement-breakpoint
CREATE TRIGGER month_close_events_immutable_update BEFORE UPDATE ON month_close_events
BEGIN SELECT RAISE(ABORT, 'BOKLI_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_immutable_delete BEFORE DELETE ON month_close_events
BEGIN SELECT RAISE(ABORT, 'BOKLI_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expense_add_requests_immutable_update BEFORE UPDATE ON operating_expense_add_requests
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expense_add_requests_immutable_delete BEFORE DELETE ON operating_expense_add_requests
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER mutation_receipts_immutable_update BEFORE UPDATE ON mutation_receipts
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER mutation_receipts_immutable_delete BEFORE DELETE ON mutation_receipts
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expense_add_requests_no_replace BEFORE INSERT ON operating_expense_add_requests
WHEN EXISTS(SELECT 1 FROM operating_expense_add_requests WHERE idempotency_key=NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_no_replace BEFORE INSERT ON month_close_events
WHEN EXISTS(SELECT 1 FROM month_close_events WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'BOKLI_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER mutation_receipts_replay BEFORE INSERT ON mutation_receipts
WHEN EXISTS(SELECT 1 FROM mutation_receipts WHERE user_id=NEW.user_id AND operation=NEW.operation AND operation_id=NEW.operation_id)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM mutation_receipts WHERE user_id=NEW.user_id AND operation=NEW.operation AND operation_id=NEW.operation_id AND payload<>NEW.payload)
    THEN RAISE(ABORT, 'BOKLI_RETRY_PAYLOAD_MISMATCH') ELSE RAISE(IGNORE) END;
END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_actor BEFORE INSERT ON month_close_events
WHEN (NEW.actor_user_id IS NULL) <> (NEW.actor_role IS NULL)
  OR (NEW.actor_user_id IS NOT NULL AND (NEW.actor_user_id<=0 OR NEW.actor_role NOT IN ('Operator','Admin')))
  OR (NEW.actor_user_id IS NOT NULL AND NEW.action='reopen' AND NEW.actor_role<>'Admin')
BEGIN SELECT RAISE(ABORT, 'BOKLI_AUDIT_ACTOR'); END;
--> statement-breakpoint
CREATE TABLE `database_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`schema_epoch` integer DEFAULT 1 NOT NULL,
	`maintenance` integer DEFAULT 0 NOT NULL,
	`backup_token` text,
	CONSTRAINT "chk_database_state_singleton" CHECK("database_state"."id" = 1),
	CONSTRAINT "chk_database_state_revision" CHECK(typeof("database_state"."revision") = 'integer' AND "database_state"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "chk_database_state_epoch" CHECK(typeof("database_state"."schema_epoch") = 'integer' AND "database_state"."schema_epoch" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "chk_database_state_maintenance" CHECK("database_state"."maintenance" IN (0,1)),
	CONSTRAINT "chk_database_state_backup_token" CHECK("database_state"."backup_token" IS NULL OR ("database_state"."backup_token" IS NOT NULL AND trim("database_state"."backup_token", char(32, 9, 10, 11, 12, 13)) <> ''))
);
--> statement-breakpoint
INSERT INTO database_state(id) VALUES(1);
--> statement-breakpoint
CREATE TRIGGER database_state_required_delete BEFORE DELETE ON database_state BEGIN SELECT RAISE(ABORT, 'BOKLI_STATE_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER database_state_required_update BEFORE UPDATE ON database_state WHEN NEW.id<>OLD.id OR NEW.revision<OLD.revision BEGIN SELECT RAISE(ABORT, 'BOKLI_STATE_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER database_state_schema_guard BEFORE UPDATE OF schema_epoch ON database_state WHEN NEW.schema_epoch<>OLD.schema_epoch AND (OLD.maintenance<>1 OR NEW.maintenance<>1 OR OLD.backup_token IS NOT NULL OR NEW.backup_token IS NOT NULL OR NEW.schema_epoch<>OLD.schema_epoch+1) BEGIN SELECT RAISE(ABORT, 'BOKLI_SCHEMA_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER database_state_backup_owner BEFORE UPDATE OF backup_token ON database_state WHEN OLD.backup_token IS NOT NULL AND NEW.backup_token IS NOT NULL AND NEW.backup_token<>OLD.backup_token BEGIN SELECT RAISE(ABORT, 'BOKLI_BACKUP_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER database_state_revision AFTER UPDATE OF maintenance,backup_token,schema_epoch ON database_state WHEN NEW.maintenance<>OLD.maintenance OR NEW.backup_token IS NOT OLD.backup_token OR NEW.schema_epoch<>OLD.schema_epoch BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER users_maintenance_insert BEFORE INSERT ON users WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER users_revision_insert BEFORE INSERT ON users BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER users_maintenance_update BEFORE UPDATE ON users WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER users_revision_update AFTER UPDATE ON users BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER users_maintenance_delete BEFORE DELETE ON users WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER users_revision_delete AFTER DELETE ON users BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_maintenance_insert BEFORE INSERT ON user_email_identities WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_revision_insert AFTER INSERT ON user_email_identities BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_maintenance_update BEFORE UPDATE ON user_email_identities WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_revision_update AFTER UPDATE ON user_email_identities BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_maintenance_delete BEFORE DELETE ON user_email_identities WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER user_email_identities_revision_delete AFTER DELETE ON user_email_identities BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_maintenance_insert BEFORE INSERT ON daily_sheets WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_revision_insert BEFORE INSERT ON daily_sheets BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_maintenance_update BEFORE UPDATE ON daily_sheets WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_revision_update AFTER UPDATE ON daily_sheets BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_maintenance_delete BEFORE DELETE ON daily_sheets WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER daily_sheets_revision_delete AFTER DELETE ON daily_sheets BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_maintenance_insert BEFORE INSERT ON cost_lines WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_revision_insert BEFORE INSERT ON cost_lines BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_maintenance_update BEFORE UPDATE ON cost_lines WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_revision_update AFTER UPDATE ON cost_lines BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_maintenance_delete BEFORE DELETE ON cost_lines WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER cost_lines_revision_delete AFTER DELETE ON cost_lines BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_maintenance_insert BEFORE INSERT ON operating_expenses WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_revision_insert BEFORE INSERT ON operating_expenses BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_maintenance_update BEFORE UPDATE ON operating_expenses WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_revision_update AFTER UPDATE ON operating_expenses BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_maintenance_delete BEFORE DELETE ON operating_expenses WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expenses_revision_delete AFTER DELETE ON operating_expenses BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER month_closes_maintenance_insert BEFORE INSERT ON month_closes WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_revision_insert BEFORE INSERT ON month_closes BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER month_closes_maintenance_update BEFORE UPDATE ON month_closes WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_revision_update AFTER UPDATE ON month_closes BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER month_closes_maintenance_delete BEFORE DELETE ON month_closes WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_revision_delete AFTER DELETE ON month_closes BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_maintenance_insert BEFORE INSERT ON month_close_events WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_revision_insert BEFORE INSERT ON month_close_events BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_maintenance_insert BEFORE INSERT ON login_attempts WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_revision_insert AFTER INSERT ON login_attempts BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_maintenance_update BEFORE UPDATE ON login_attempts WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_revision_update AFTER UPDATE ON login_attempts BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_maintenance_delete BEFORE DELETE ON login_attempts WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER login_attempts_revision_delete AFTER DELETE ON login_attempts BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER operating_expense_add_requests_maintenance_insert BEFORE INSERT ON operating_expense_add_requests WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER operating_expense_add_requests_revision_insert AFTER INSERT ON operating_expense_add_requests BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER mutation_receipts_maintenance_insert BEFORE INSERT ON mutation_receipts WHEN NOT EXISTS(SELECT 1 FROM database_state WHERE id=1 AND maintenance=0) BEGIN SELECT RAISE(ABORT, 'BOKLI_MAINTENANCE'); END;
--> statement-breakpoint
CREATE TRIGGER mutation_receipts_revision_insert AFTER INSERT ON mutation_receipts BEGIN UPDATE database_state SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER database_state_no_replace BEFORE INSERT ON database_state
WHEN EXISTS(SELECT 1 FROM database_state WHERE id=1)
BEGIN SELECT RAISE(ABORT, 'BOKLI_STATE_REQUIRED'); END;
--> statement-breakpoint
-- Explicit ABORT cannot be suppressed by an outer OR IGNORE/REPLACE policy.
CREATE TRIGGER database_state_range_guard BEFORE UPDATE ON database_state
WHEN typeof(NEW.revision)<>'integer' OR NEW.revision NOT BETWEEN 0 AND 9007199254740991
  OR typeof(NEW.schema_epoch)<>'integer' OR NEW.schema_epoch NOT BETWEEN 1 AND 9007199254740991
  OR NEW.id IS NOT 1 OR NEW.maintenance IS NULL OR NEW.maintenance NOT IN (0,1)
  OR (NEW.backup_token IS NOT NULL AND trim(NEW.backup_token,char(32,9,10,11,12,13))='')
BEGIN SELECT RAISE(ABORT, 'BOKLI_STATE_RANGE'); END;
--> statement-breakpoint
-- Month Close history changes through explicit audited state updates. Never let
-- DELETE or REPLACE erase a closed/reopened record and thereby unlock its month.
CREATE TRIGGER month_closes_history_delete BEFORE DELETE ON month_closes
BEGIN SELECT RAISE(ABORT, 'BOKLI_CLOSE_STATE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_history_insert BEFORE INSERT ON month_closes
WHEN EXISTS (SELECT 1 FROM month_closes WHERE id=NEW.id OR month=NEW.month)
BEGIN SELECT RAISE(ABORT, 'BOKLI_CLOSE_STATE_IMMUTABLE: UNIQUE month_closes'); END;
--> statement-breakpoint
CREATE TRIGGER month_closes_history_identity BEFORE UPDATE ON month_closes
WHEN NEW.id<>OLD.id OR NEW.month<>OLD.month
BEGIN SELECT RAISE(ABORT, 'BOKLI_CLOSE_STATE_IMMUTABLE'); END;
