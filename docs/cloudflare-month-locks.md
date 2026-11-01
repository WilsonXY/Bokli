# Month Close migration guards

Migrations reach the cloud database only through the deploy workflow
(`wrangler d1 migrations apply`). Never use `db:push`. Migration 0009 adds
SQL guards only; migrations 0000–0008 and all tables/columns remain unchanged.
Historical `reopened_at = ''` becomes NULL before guards are installed. New
empty markers are rejected. NULL means closed, a nonempty marker means reopened,
and re-close restores NULL. The services still write state and audit atomically;
these guards do not manufacture audit events or authorize a caller.

The migration protects all nine Daily Sheet, Cost Line and Operating Expense
INSERT/UPDATE/DELETE paths, both sides of month moves and displaced rows under
INSERT/UPDATE OR REPLACE. Month Close identity/history cannot be erased or
replaced; explicit close/reopen/reclose updates remain supported. Audit and
main's expense receipts are immutable. The expense ledger still has its original
keys, payload/result/status semantics and no expense FK: replay survives deletion
and a later close. No receipt garbage collection or new retry policy is added.

Shared SQLite/local workerd cases use native migration bookkeeping and fresh
synthetic databases. They exercise fully migrated locks and an atomic parent/child
rebuild with retained metadata, child rows, objects, audit and receipts. Deleted
highest IDs and sequence marks above 2^53 are read as decimal text on both
engines. Local tests do not prove remote CPU/quota or production recovery.
