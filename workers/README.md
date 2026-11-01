# Plain Worker API

`index.ts` uses Web Crypto RS256, the supported D1 adapter for reads, and native
prepared D1 batches for atomic writes. No test identity mode or recovery controller.

## Verified identity and configuration

Every invocation requires explicit `BOKLI_DB`, `ACCESS_ISSUER`, `ACCESS_AUD`,
`ACCESS_ALLOWED_EMAILS` (comma-separated canonical normalized emails),
`ACCESS_HEALTH_SERVICE_ID` (the exact Access service client ID), and `APP_VERSION`.
Missing/invalid configuration returns 503. No environment-file or database fallback.
The issuer is an HTTPS Access team origin without a trailing slash. The verifier
uses only its `/cdn-cgi/access/certs`, checks RS256/key/signature/issuer/AUD/type/
expiry/issuance/not-before, and fetches keys afresh: unknown key fails 401; JWKS
outage/invalid response fails 503. Only `Cf-Access-Jwt-Assertion` is accepted.
Cookies, Authorization, email/role/service credential headers cannot authenticate.

The signed user email is normalized with ASCII lowercase and trim, approved by the
configured allow-list, and joined through `user_emails` to the actual `users` row.
Roles and credentials remain on `users`; no passwords or email maps are returned.
Migration `0010_user_email_mapping` is additive and does not seed any identity.
Mappings require a separate approved configuration/import step before deployment.

A signed service token (`common_name`, empty `sub`, no email) is allowed only on
exact `GET /api/health` without a query. It checks the D1 binding with `SELECT 1`
and returns `{status, version}`. Every data route rejects all service identities.
Paths are matched exactly after the platform's standard URL normalization; no
encoded/case/alias path grants data access. Unknown/ambiguous identities fail 403.

## Protected reads

All page reads are `GET /api/cloud-v1/<route>`:

| Route | Parameter | Response |
| --- | --- | --- |
| identity | none | actual ID and role |
| sheets | optional date | resolved date/today/closed state and nullable Daily Sheet with ordered Cost Lines and totals |
| dashboard | optional month | active month, Month Tiles, chronological trend, Cash/TnG split, Cost Category breakdown |
| expenses | optional month | month selection, ID-ordered Operating Expenses, live summary and closed state |
| close | optional month | month selection, live financials, current Month Close/Reconciliation, sheet presence and role |
| history | none | Month Close records/Reconciliation, newest month first |

Defaults, invalid/future selection and missing-month behavior match current page
loaders. Closed Dashboard tiles use snapshots; reopened tiles/live summaries use
current records. SQL is parameterized. INTEGER money/IDs and SQL aggregate sums
cross D1 as decimal text, then checked bigint arithmetic precedes JSON numbers.
Unsafe amounts/components/profit/Reconciliation or signed-int64 SUM overflow
return 422 `moneyRange`; failures never return zero-filled success.
Unknown/duplicate/oversized query parameters return 400 `invalidQuery`.
Responses are `no-store`; no CORS or alternate authorization bypass is exposed.

## Atomic writes and retry resolution

`src/lib/cloud-contract.ts` defines the implemented request/result envelopes.
POST sheets, POST/DELETE expenses, POST close, POST close/reopen, and bodyless
DELETE sheets use `/api/cloud-v1/*`. Mutations require the exact request Origin,
the `X-Bokli-Api-Generation: cloud-v1` CSRF marker and JSON content type when a
body is present. The marker is not authentication. Reopen and its status/replay
remain Admin-only. Unsupported methods return 405.

Every keyed mutation scopes its durable operation ID to the mapped actor and
operation. Retry consumers persist the mapped actor ID with the draft/key and
send `X-Bokli-Actor-Id` on writes and status. The server compares it with the signed
mapped identity; an account switch returns 403 `identityChanged` before reading
the result or writing. Raw compatibility callers can omit it; automatic retries
require it. One native D1 batch claims the key, checks the singleton maintenance
guard and current mapping/permission, mutates, records committed actor history
for Month Close transitions, validates the result and stores it. A concurrent
duplicate skips mutations and returns the stored result; changed payloads fail
(expense adds retain 400, other operations 409). Replays survive later edits,
deletes and closes. Completed receipts, legacy ledger and audit history are
immutable, with no expiry or garbage collection. Migration 0011 is additive.

`GET operations/status?operation=<name>&operationId=<key>` reads authenticated
caller-scoped results with a `first-primary` D1 session. Names are `sheet.save`,
`sheet.delete`, `expense.add`, `expense.delete`, `month.close`, `month.reopen`.
It returns `{saved:false}` or `{saved:true,status,result}`. The compatible
`GET expenses?idempotencyKey=<key>` uses the same caller-scoped resolution.
Expense adds preserve 200/201, `merged`, `alreadySaved` and replay semantics.
Unkeyed expense POSTs are compatibility-only and never automatically retried.

Historical ledger rows contain no actor. `legacy_expense_receipt_owners` supplies
explicit, verified imported ownership without editing the ledger or guessing.
Unmapped/other-actor historical key collisions fail 409 `legacyReceiptUnscoped`;
their status returns no result (an unknown owner returns 409, never false certainty).
Already accepted scoped results take precedence over later imported key collisions.
Import/ownership approval is a later prerequisite.

Whole Daily Sheet replacement remains last-complete-save-wins, with retained IDs
and monotonic delete tokens. Cost Lines are capped at 30 before/after grouping;
bulk expense deletion at 50 IDs. Close compares exact component totals and sheet
count in the commit and makes at most three stale-snapshot attempts, then 409.
Maintenance is DB-backed and checked at commit; there is no runtime toggle route.

Composite reads are coherent with concurrent writes: Daily Sheet parent/Cost Lines
use one joined SELECT; month selection, totals and detail queries use one native
read batch. Defaults and result envelopes are preserved; no interactive transaction.

Unknown write failures return 503 `outcomeUnknown`: a lost response/1102 does not
prove rollback. `src/lib/cloud-write.ts` resolves authenticated status and permits
one same-key retry after `saved:false`; it consumes successful bodies within the
recovery boundary, so lost/malformed bodies cannot escape as accepted headers. It
never retries unkeyed requests. Callers
must durably persist the ID, mapped actor and normalized request before using it, retain drafts
on unknown outcomes and preserve the existing pending-expense storage contract.
Read replication stays off.
Rollback ingress must reject the cloud namespace regardless of markers.

Parameterized raw SQL batches fail in Drizzle 0.45.3's raw-query batching path.
Writes therefore use its public SQLite SQL compiler and D1's native `batch`,
without private adapter access or interactive transactions. SQL INTEGER results
are validated inside the transaction before JSON serialization; aggregates cross
the preliminary close read as text for bigint checks. All money/result/guard
failures roll back the complete batch, including its pending claim and audit.

## Local verification and deployment separation

`npm run test:d1` retains the foundation/migration suites and then runs the actual
Worker in isolated workerd with ephemeral local D1, signed synthetic JWTs and
network-disabled JWKS fixtures. SQLite reference responses are generated using
current retained services over an in-memory synthetic DB. No remote database,
external Wrangler config, persistence path or account credentials are used.
Bundle/config checks run in `test:deploy`; the independent esbuild
bundle includes neither Node/Next/auth/SQLite runtime nor test authorization.

`wrangler.json` disables workers.dev and preview URLs; `/api/*` runs before assets.
It contains no routes, database IDs, account settings or auth values. Deployment and
approved bindings/configuration/real identity/remote CPU gates remain later work.
Nothing is deployed by tests or feature pushes.

## Static screens

`npm run build` exports the four screens to `out/`. Each page is a client shell
(`src/components/CloudPage.tsx`) that reads `/api/cloud-v1/*` and renders the usual
view; writes go through `apiFetch` (`src/lib/cloud-client.ts`). It sends the mapped actor, one Idempotency-Key per save
attempt (reused while the draft is unchanged; Operating Expenses keep their stored
pending keys) and asks `operations/status` before resending an unknown outcome.
Today's date comes from the Worker per request. Sign Out goes to
`/cdn-cgi/access/logout`. Next uses `.next` as scratch space for the export.

## Running it locally

`npm run cloud:local -- --port 8787` builds `out/`, applies `drizzle/` to a fresh
local D1 in a temp folder, seeds synthetic data and runs `wrangler dev` on
127.0.0.1. It writes its own Wrangler config there (this file plus a local D1
binding); nothing touches an account. Real Access (e.g. behind a tunnel) reads
`workers/.dev.vars` (git-ignored): the five variables above, with the Operator's
email first and the Admin's second in `ACCESS_ALLOWED_EMAILS`. Add
`--public-origin https://<host>` so writes accept the browser's Origin.

`--test-identity` is for automated tests: the entry becomes
`local-test-identity.ts`, which trusts only a key generated for that run and only
its synthetic issuer; deployments use `index.ts`, which never accepts it.
`node scripts/cloud-verify.mjs scripts/cloud-flows/<flow>.mjs [mom|katte] [--mobile]`
runs a browser flow against it and keeps video and screenshots in `.evidence/`.
