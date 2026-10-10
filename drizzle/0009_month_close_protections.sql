-- Normalize only the historical empty marker before installing protections.
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
-- Preserve history through explicit service state updates, never DELETE/REPLACE.
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
CREATE TRIGGER operating_expense_add_requests_no_replace BEFORE INSERT ON operating_expense_add_requests
WHEN EXISTS(SELECT 1 FROM operating_expense_add_requests WHERE idempotency_key=NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'BOKLI_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER month_close_events_no_replace BEFORE INSERT ON month_close_events
WHEN EXISTS(SELECT 1 FROM month_close_events WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'BOKLI_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
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
