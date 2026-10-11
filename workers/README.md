# Additive plain Worker API (Stage3)

The laptop Next/Auth.js/SQLite runtime and legacy `/api/*` handlers are unchanged.
`index.ts` uses only the supported `drizzle-orm/d1` adapter and Web Crypto RS256.
No writes, test identity mode, retry service, recovery controller or actor schema.

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

`src/lib/cloud-contract.ts` is the client-safe typed read and next-stage mutation
transport. All future mutations use `/api/cloud-v1/*`, a durable `Idempotency-Key`,
and the `X-Bokli-Api-Generation: cloud-v1` compatibility marker. Stage4 must provide
atomic receipts, identity scoping, status resolution and Origin/CSRF/role checks;
the marker is not authentication. Unsupported methods and `close/reopen` return
405 `mutationNotSupported`, never a success-shaped stub. Legacy API contracts are
unchanged. Rollback ingress must reject the namespace regardless of markers;
no cloud client may fall back to laptop mutation routes.

## Local verification and deployment separation

`npm run test:d1` retains the foundation/migration suites and then runs the actual
Worker in isolated workerd with ephemeral local D1, signed synthetic JWTs and
network-disabled JWKS fixtures. SQLite reference responses are generated using
current retained services over an in-memory synthetic DB. No remote database,
external Wrangler config, persistence path or account credentials are used.
Deployment-bundle/config checks run in `test:deploy`; the independent esbuild
bundle includes neither Node/Next/auth/SQLite runtime nor test authorization.

`wrangler.json` disables workers.dev and preview URLs; `/api/*` runs before assets.
It contains no routes, database IDs, account settings or auth values. `out/` is the
future Stage5 static export, not a placeholder screen. Deployment and approved
bindings/configuration/real identity/static-screen/remote CPU gates remain later
work. Nothing is deployed by tests or feature pushes.
