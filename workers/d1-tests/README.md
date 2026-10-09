# Local D1 foundation (PR1)

Run from the repository root on Node 22:

```sh
npm ci --no-audit --no-fund
npm run test:d1
```

The tests run **inside real local workerd**, with Miniflare's D1 binding. They do
not mock Drizzle or D1 results. `npm test`, `test:unit` and `test:deploy` retain
exactly their existing SQLite/unit/deploy commands; run `test:d1` separately. CI adds
`d1-foundation` alongside the existing checks, including migration consistency.

No Cloudflare account, credentials, network deployment, Wrangler configuration
or app SQLite path is used. The only database binding is `BOKLI_TEST_DB`. The
configuration guard rejects remote bindings, Wrangler configs, shared storage,
extra bindings and persistence overrides (including `data/` and `data-dev/`).
Use the checked-in command without pool/config CLI overrides: the guard checks
this config object, not arbitrary overrides Vitest applies afterwards.
The Cloudflare pool owns temporary storage, restores it after each test and
removes it on shutdown. Each integration test asserts an empty database before
applying migrations. No app database is opened or cleaned up.

`readD1Migrations` / `applyD1Migrations` apply the repository's current `drizzle/`
SQL files unchanged. D1 test migration bookkeeping uses `d1_migrations`; this is
**not** the production Drizzle migration runner or an import/upgrade protocol.
Coverage includes empty bootstrap/reapply, the existing retry-ledger table,
parameterized ordered Drizzle batch results, FK rejection/cascade, mid-batch
CHECK/UNIQUE/trigger abort rollback, full old payload preservation, no stray
rows/audit, unknown errors and per-test storage/trigger isolation.

`workers/d1.ts` is an additive async boundary importing only the shared schema.
It requires an explicit binding and calls the supported public Drizzle
`drizzle-orm/d1` and `db.batch()` APIs. Never use interactive
`db.transaction()`/BEGIN/COMMIT for D1. A failed batch keeps the original error as
`cause`; no retry or HTTP/business mapping is added. Known local FK/CHECK/UNIQUE
messages are classified; trigger messages must be supplied explicitly and match
exactly. Unregistered trigger text can resemble a native constraint message, so
classification is a local message heuristic, not a stable SQLite error code.
Other errors stay unknown. These message surfaces need remote tests
before production use. The triggers/fixtures here are test-only, not Month Close
locking or a new production schema.

The root Vitest 3.2 suite is retained. `@cloudflare/vitest-pool-workers` 0.12.21 is
the newest published version whose peer range supports it; Worker types match
the pinned runtime/compatibility date (2026-03-10). Newer
`@cloudflare/vitest-plugin` requires Vitest 4.1+. The old package is deprecated
and frozen, so a future runner upgrade needs separate verification. Local D1
does not establish remote CPU/quota limits, production auth, real-data imports,
concurrent application saves or backup/restore readiness.

References: [Drizzle batch API](https://orm.drizzle.team/docs/batch-api),
[D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[Cloudflare testing APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/).

The existing Next/SQLite routes, auth, UI and deploy scripts are unchanged.
The staged deploy script uses `npm ci --include=dev`, so a future approved deploy
also installs this test toolchain (Wrangler/Miniflare/workerd/native packages).
That increases staged install size and third-party install scripts; install
failure stops in staging before production is touched. No deploy is run by PR1.
Preview: N/A. PR2 and every merge/deployment need their own owner approval.

## PR2 schema contracts

The retained foundation suite now expects additive schema tables/guards and the required
state singleton. `contracts.test.ts` runs the same synthetic SQL cases as SQLite, beginning
from the checked, pinned baseline and then expanding populated history. Coverage includes
all nine locks/moves, NULL/empty/reopen states, normalized mapping collisions, audit/receipt
immutability/replay, maintenance/revision/epoch rollback, parent+child rebuilds, metadata,
sequence marks and reverse projection with a private sidecar. No real data or second binding.
See [schema contracts](../../docs/cloudflare-schema-contracts.md) for bootstrap and rollback
limits. These synthetic contracts do not enable a production converter, cloud auth/write
service or backup pipeline. PR3/6a remain separately authorized work.
