# Month Close migration and future recovery

This branch keeps the laptop runtime and native migration commands:
`BOKLI_DB_PATH=<explicit-destination> npm run db:migrate`, or the existing
`runMigrations()` deployment helper. Never use `db:push`. Migration 0009 adds
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

Future bootstrap/rollback tools must pin the actual supported source and frozen
schema/migration inventory, permit normal laptop upgrades and refuse unknown
layouts. Compare actual applied migration hashes and schema, never only a
number or tag: historical PR69's 0009 differs from this branch's 0009. Never
run this branch's migration on a database that applied PR69's alternate 0009. Under an offline writer barrier install
tables, then FK-ordered rows, migration metadata and exact decimal sequence marks,
then indexes/triggers; verify content, money, audit, receipts and lock behavior
before authorized handoff. Never blindly copy or clear temporary cloud ownership.
Preserve unsupported new receipts in a verified private sidecar, and establish
stale-client namespace/status/draft barriers before laptop writes resume. Complete
multi-layout/control/restore tools and tests are required before first recovery
exposure in PR6a/6b; this PR provides no converter or import command.

Identity lookup belongs to PR3. Scoped general retries, actor columns and one
shared atomic maintenance barrier belong to PR4 with their consumers. PR6a must
prove binding-first consistent capture at 1×/10×, with revision paging as the
default fallback; requalify actual PR4 schema/receipt growth before sign-off.
Native export and paused capture need separate owner credential/outage decisions.
Retention, offsite verification, exact integers, restore, CPU and release gates
remain unchanged. No backup controls or pipeline are installed here.

Shared SQLite/local workerd cases use native migration bookkeeping and fresh
synthetic databases. They exercise fully migrated locks and an atomic parent/child
rebuild with retained metadata, child rows, objects, audit and receipts. Deleted
highest IDs and sequence marks above 2^53 are read as decimal text on both
engines. Local tests do not prove remote CPU/quota or production recovery.
