# Cloudflare schema contracts (PR2)

This is additive schema groundwork. The Next.js/SQLite laptop runtime, username/password fields,
legacy expense API and all current suites stay supported. No Worker route, auth/UI switch,
remote resource, production converter or backup pipeline is enabled here.

## Bootstrap boundary

`drizzle/bootstrap-baseline.json` preserves the immutable 0000–0008 boundary, including main's
0008 expense ledger. `drizzle/bootstrap-supported.json` additionally pins the actual supported
0009 layout. Each profile contains SQL/snapshot SHA-256, journal timestamps, the compact-JSON
migration inventory ID, and the business table/column/index/trigger inventory digest. Normal
laptop fresh installs and upgrades to 0009 remain supported. Proof-era numbering is not used.

`supportedLayout` validates either captured source and frozen destination against these profiles,
including the actual SQLite Drizzle or D1 applied-migration inventory. SQLite metadata DDL permits
the two explicit native/coordinator definitions; D1 permits the pinned pool/Wrangler definitions.
Unknown schema, objects, migration list, malformed controls or unsafe/incomplete sequence marks
are refused, including structurally similar schemas with unpinned SQL. A later authorized rehearsal
must inventory the actual source on a protected copy. Historical `db:push`/rename variants require
an explicitly approved additional inventory; this contract never guesses equivalence or silently
weakens the guards. PR2 reads no real source database.

A later bootstrap tool must install the **verified source's actual supported layout** into an empty,
explicitly bound, offline destination: all tables first, original rows in FK order, original migration
metadata and exact AUTOINCREMENT marks, then indexes/triggers. This ordering permits closed and
reopened history at either 0008 or 0009 without triggering audit or locks during row installation.
Verification covers content/aggregates/FKs/integrity/schema/metadata/sequences/receipts and private
read-back. The `import-verified` marker is tied to that profile's artifact ID; `assertExpansionBoundary`
uses the shared `assertPinnedArtifacts` check. A marker asserts completed external verification;
it does not perform content verification or authenticate its issuer.

For a 0008 source, apply only pending 0009 expansion after verified import. For a 0009 source,
retain 0009 bookkeeping and do not replay expansion. Destination controls must remain protected
under the offline writer/ingress barrier until the separately authorized verified handoff below.
A 0008 destination cannot enforce maintenance in its old schema: keep every writer stopped until
expansion has installed the guard inventory and destination maintenance. Never expose the gap
between row installation, object installation and protected control initialization. Test fixtures
model the installation order; they are not a production importer. Expansion is atomic and begins
at schema epoch 1; unchanged reapplication preserves metadata, revision and epoch.

Never apply all pending migrations before importing closed-month history. Expansion converts
only historic `reopened_at=''` to NULL; it does not rewrite historical audit JSON or fabricate
actors/events. New empty reopen values are rejected. NULL and empty are closed in lock predicates;
a nonempty reopen timestamp is open. All nine Daily Sheet/Cost Line/Operating Expense writes,
both sides of moves, revenue-only edits, cascades and replacement inserts are guarded.

## Identity, receipts and audit

`user_email_identities.email` is the unique normalized key, joined to `users.id` and its current
role. Normalize with SQLite `lower(trim(value,char(32,9,10,11,12,13)))` consistently for mapping
and lookup. This means ASCII case folding and the six ASCII whitespace characters; do not
silently substitute a different JavaScript/Unicode normalization rule. PR3 must share this rule.
No mappings are populated by migration. Credentials and existing identities remain intact.

`mutation_receipts` keys are `(user_id, operation, operation_id)`. Identity is the durable,
non-reused user ID, not a mutable email/role. The normalized payload and sanitized successful
status/result are durable terminal receipts. No business-row/user FK, expiry, GC or pending
claim that can survive alone. PR4 must guard **every** mutation/audit statement against an
existing scoped receipt and insert its receipt in the same atomic batch. A matching insert
is ignored without overwriting its original response; changed payload aborts the batch.
All statements must be gated: an ignored receipt alone cannot undo an ungated earlier write.
Tests demonstrate the SQL contract, not a new production mutation service/status API.

The legacy `operating_expense_add_requests` namespace, keys, request fields, stored JSON and
200/201/alreadySaved semantics remain unchanged. Do not guess owners for imported global keys
or move them into the scoped ledger. The unchanged laptop compatibility routes continue their
existing authorized replay behavior. Future cloud operations use their distinct transport and
scoped namespace; no automatic legacy replay/ownership adoption is authorized by this schema.
PR4 must reconcile any unknown legacy outcomes before issuing a new cloud key.

Audit/receipts reject updates, deletes and replacement overwrites. Month Close rows reject DELETE,
replacement inserts and ID/month changes; explicit reopen/reclose UPDATE remains supported. The
existing laptop service uses INSERT for a new month and UPDATE for an existing month, paired with
its audit event in the same transaction. No new raw-SQL audit policy or generated events are added.

Audit actor ID/role are
nullable together for historical/laptop events; new cloud events must supply the verified
actor, and a supplied reopen actor must be Admin. The current service still writes its event
with the state in one SQLite transaction. Raw SQL cannot authenticate an actor; auth and the
cloud close/reopen batch services remain PR3/4. No audit-generating triggers duplicate service
events. Reason, timestamp and committed snapshot behavior stays with those services.

## Maintenance, migrations and consistent capture

`database_state` is a required singleton. Defaults keep laptop writes enabled. Maintenance
blocks mutable application tables, including identity, login state, audit and receipt inserts,
at statement time. Revision increments in the same transaction for every mutable row, even
note/category changes or updates with unchanged financial totals. Failed batches roll back
revision; scoped replays do not change it. Revisions/epochs are safe nonnegative integers and
fail closed on exhaustion. Revision increments are per row, not one per logical operation.

A backup acquires `backup_token` by compare-and-set when NULL, then captures its starting
revision/schema epoch **after acquiring it**. Release only with that same token. The DB rejects
replacing another active token. A paged capture is valid only if token, revision and schema epoch
are unchanged at completion; any intervening application or control write invalidates it.
Normal writes remain allowed during capture. Maintenance/token/epoch changes also bump revision.
There is no token timeout, automatic lease clearing, retention deletion or backup job in PR2.
A crashed holder needs an explicit recovery procedure in PR6a; do not bypass its token.

`npm run db:migrate` and deployment's existing `src/db/migrate.ts` use the guarded SQLite runner:
an IMMEDIATE transaction covers the backup-token check, maintenance barrier, SQL, Drizzle-format
metadata, epoch bump and restoration of the previous maintenance state. Reapplication has no
revision/epoch change. Drizzle's public migration parser supplies SQL/hashes/timestamps; its
synchronous migrator owns BEGIN and cannot wrap this coordination transaction.

`src/db/schema-guards.json` pins required index/trigger definitions. Loss or changed definitions
abort the migration transaction. An approved future schema change must update this inventory
and behavior tests deliberately. Do not use direct `drizzle-kit migrate`, uncoordinated DDL,
direct `db:push` (its forbidden script was removed), or a remote Wrangler migration command as a bypass.
D1's future production migration runner
must provide the same atomic maintenance/token/epoch/metadata contract; PR2 tests guarded DDL
batches in real local D1, not remote deployment coordination. SQLite cannot prevent arbitrary
DDL issued by a trusted DB owner. The safety boundary is the approved coordinator.

Future data migrations cannot blindly UPDATE guarded rows while the runner holds maintenance:
those statements deliberately abort. Any later approved data rewrite must define a guarded table
rebuild/install order within the owned transaction, deliberately retain/reinstall the pinned objects,
verify data/FKs/sequences and advance epoch/revision before restoring the prior maintenance state.
PR2 provides no automatic trigger bypass or migration-data policy.

Login-attempt writes, including failed logins, invalidate a paged capture just like every other mutable
row. Excluding them would permit an inconsistent full image. The later backup design must prove a
bounded capture/maintenance strategy under its separately approved feasibility gate; this schema
does not promise captures succeed under sustained writes. Per-row nested revision cost must be
measured in the approved PR4/6a work against the real CPU limit and 10× backup gate. CPU reliability
and backup consistency are not waived or claimed here.

## Rebuild and reverse-conversion contracts

Restore all table definitions first, explicit-column rows in FK order, sequence/metadata marks,
then indexes/triggers. Do not depend on sqlite_master creation order. Rebuild parent and child
together under FK ON: copy both before dropping child then parent; rename replacements, restore
sequence high-water marks and all indexes/triggers in the same guarded transaction. FK OFF
inside a transaction is ineffective. Synthetic SQLite/D1 tests exercise this order and locks.

`reverseForLegacy` is an asynchronous pure image projection (hash validation only), not a DB/file
importer or export service. Both captured layouts must pass `supportedLayout`. The actual
frozen laptop schema supplies tables, columns, objects and migration metadata. Project current
business rows into it; restore missing credential fields from the frozen source without creating
dummy credentials. Preserve sequence high-water marks. Retain **the full expanded image**, including
new receipts, audit actor fields, identity mapping, expanded migration metadata and guards, in a
verified **private sidecar**. Never publish that sidecar or treat a legacy database alone as proof
that new cloud receipts were preserved. The frozen legacy expense ledger remains in the DB.
Production tooling must validate schema constraints, content hashes, safe integer encoding,
FKs, quick/integrity checks and sidecar byte read-back before installation.

The source cloud `database_state` is preserved verbatim in the private sidecar, including its
maintenance/backup ownership. It is **not** the restored destination's ownership. For a frozen 0009
destination, the planned row keeps the frozen schema epoch, sets maintenance to 1, assigns no
backup owner (`NULL`), and advances revision to `max(source,frozen)+1`. Revision exhaustion refuses
conversion. This initializes a distinct offline destination; it never clears the captured source's
controls, resets counters, or authorizes writes. The frozen migration records and platform metadata
sequence remain exact; business sequence marks take the higher frozen/source value.

After full verification and private read-back, `assertRestoreHandoff` requires an authorized,
`restore-verified`, offline-destination marker bound to the exact planned image hash and exact
observed image. The later trusted issuer must already have verified content/schema/FKs/integrity,
metadata/sequences/audit/receipts and rollback ingress/status/draft requirements. A 0009 destination
must still have maintenance=1 and no backup owner. Release maintenance by compare-and-set against
that verified revision and schema epoch, in the owned handoff transaction, before exposing writers.
Release itself advances revision; stale verification cannot release a changed destination. The
external exclusive/offline barrier is essential: raw DDL and system-table writes by a trusted owner
cannot be fenced by application triggers. For 0008, the offline barrier remains the protection until
pending expansion and the same guarded destination-control handoff. This contract does not create a
marker, perform installation, stop/start an app, or grant release approval.

SQLite and real local D1 regressions restore a 0009 frozen image captured with cloud maintenance and
active backup ownership, reject writes before handoff, retain exact audit/receipts/metadata/sequences,
and permit guarded writes/DDL after handoff. SQLite additionally exercises the existing bcrypt login
service and actual coordinated migration runner; no new auth/API/UI wiring is introduced.

Rollback still needs the later, tested ingress barrier rejecting the cloud-only mutation namespace,
status reconciliation and draft recovery before enabling laptop writes. Preserved receipts do not
make the frozen laptop understand cloud mutation APIs. No real-data copy/installation or timed
rollback drill is claimed. PR6a's separately authorized 10× backup CPU feasibility gate comes next;
backup reliability was not waived by the accepted UX/Month Close exceptions.

AUTOINCREMENT insert attempts bump revision in BEFORE INSERT: SQLite can advance
`sqlite_sequence` even when OR IGNORE discards the row. This is a conservative
fence; ignored attempts can advance revision without changing business rows.
ABORT/failed batches roll both revision and sequence back. Gated receipt replays
produce no candidate business/audit insert, preserving their unchanged revision.
Explicit sequence restoration remains trusted coordinator work under the same
maintenance/schema-epoch boundary; system-table writes cannot have SQLite triggers.
UPDATE guards also protect a conflicting closed row displaced by UPDATE OR REPLACE,
independent of recursive_triggers settings.

All six AUTOINCREMENT tables, including Month Close, use the attempted-insert
fence. The synthetic cases check this against the actual schema inventory.
Control validity uses explicit RAISE(ABORT) as well as CHECK constraints: an outer
OR IGNORE/REPLACE policy must not suppress revision/epoch exhaustion or invalid
control fields and then allow untracked rows/DDL. BOKLI_STATE_RANGE aborts the
whole transaction; no counter wrap/reset or ignored overflow is permitted.

Shared case/image helpers are test-only and have no application/deployment importers. Their current
paths are retained to avoid an unrelated move; exact decimal sequence validation now rejects unsafe
SQL before constructing fixture statements. The shared artifact check is used by both unit contracts
and D1 configuration, which validates both supported profiles before starting workerd.
