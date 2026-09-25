# Runbook: Password Reset + AUTH_SECRET Rotation

**Applies to:** resetting a Bokli login (`mom` or `katte`) and revoking the
sessions that the old password could still be holding open.

**Audit decision #6 (2026-09-25):** rotate `AUTH_SECRET` after *every* password
reset. Sessions are JWTs, so this logs out **every** user — mom included. That
is accepted and desired; it is the only session-revocation mechanism we have.
There is deliberately no `sessionVersion` column and no per-user revocation.

---

## 1. Why the rotation step is not optional

Bokli uses Auth.js credentials auth with a **JWT session strategy**
([ADR-0003](adr/0003-credentials-auth.md), `src/auth/config.ts`). Sessions are
stateless: the session cookie is a token signed with `AUTH_SECRET`, valid for 30
days (`SESSION_MAX_AGE`), and the server never checks it against the database.

Consequence: **`npm run reset-password` changes the bcrypt hash in the DB, but
anyone already logged in stays logged in.** A stolen or shared session cookie
keeps working until it expires. Changing the signing secret invalidates every
outstanding token at once, which is why the reset is only half the job.

`src/auth/config.ts` reads the secret as `AUTH_SECRET ?? NEXTAUTH_SECRET`. The
deployment guide keeps both set to the same value, so set **both**.

---

## 2. Prerequisite: `BOKLI_DB_PATH` must be exported

The reset CLI runs as a plain `tsx` script (`npm run reset-password` →
`tsx src/cli/reset-password.ts`). **It does not load `.env.local` or `.env`** —
nothing in this repo pulls in `dotenv`; only `next dev` / `next build` read
those files, and prod gets its env from the systemd unit.

`src/db/index.ts` fails closed by design: with `BOKLI_DB_PATH` unset it throws
rather than guessing `./data/bokli.db` (which is the **prod** DB in the prod
checkout). So running the CLI bare gives:

```
Error: BOKLI_DB_PATH is not set. Refusing to guess a database path. ...
```

That is correct behaviour — **do not "fix" it by adding a fallback.** Export the
path for the command instead (see below). Always confirm the path you export
points where you intend: `data-dev/` for dev, `data/` for prod.

---

## 3. Dev procedure (scratch DB, no rotation needed)

Dev config lives in `.env.local` (git-ignored). Pass the dev DB path explicitly:

```bash
cd ~/projects/bokli-dev

# Sanity-check the path first — it must contain data-dev/
grep BOKLI_DB_PATH .env.local

BOKLI_DB_PATH=/home/penguin/projects/bokli-dev/data-dev/bokli.db \
  npm run reset-password -- mom
```

You are prompted for the new password (masked on a TTY). Rotating the dev
`AUTH_SECRET` is optional; if you want to clear dev sessions, edit `AUTH_SECRET`
in `.env.local` and restart `next dev`. **Dev uses `.env.local` and a dev-server
restart — never `.env`, never systemd.**

---

## 4. Prod procedure (reset + rotation)

Run on the deployment host, in the prod checkout (`~/projects/bokli`).

### Step 4.1 — Reset the password

```bash
cd ~/projects/bokli

# The systemd unit sets BOKLI_DB_PATH for the service, not for your shell.
# Take the value from the prod .env and confirm it points at data/ (not data-dev/):
grep BOKLI_DB_PATH .env

BOKLI_DB_PATH=/home/penguin/projects/bokli/data/bokli.db \
  npm run reset-password -- mom
```

Expected output: `Password for user "mom" reset successfully.` followed by the
rotation reminder. If you see `User "<name>" not found.`, check the username
(matching is case-insensitive; the seeded accounts are `mom` and `katte`).

### Step 4.2 — Generate a new secret

```bash
openssl rand -base64 32
```

### Step 4.3 — Set BOTH secrets in the prod `.env`

Edit `~/projects/bokli/.env` and set both names to the **same** new value:

```ini
AUTH_SECRET=<new value from openssl>
NEXTAUTH_SECRET=<same value>
```

`.env` should stay `chmod 600`. Do not commit it — it is git-ignored.

### Step 4.4 — Restart the service

```bash
systemctl --user restart bokli
```

The unit loads `.env` via `EnvironmentFile=`, so the new secret is picked up on
restart. Nothing else applies it — an un-restarted service keeps signing and
accepting tokens with the old secret.

Confirm it came back up (an `ExecStartPre` build-stamp check can block start):

```bash
systemctl --user status bokli
journalctl --user -u bokli -n 20 --no-pager
```

### Step 4.5 — Smoke-test login

```bash
SMOKE_USER=mom SMOKE_PASS='<the new password>' \
TARGET_URL=http://localhost:5000 \
  npm run smoke:login
```

Look for `STATE: SUCCESS: reached authenticated page (...)`.

> **Point it at `http://localhost:5000`, not `https://bokli.ktte.me`.** The
> public hostname sits behind the Cloudflare Access gate, which blocks
> automation; the script then prints `STATE: SKIP: Cloudflare Access gate
> detected` and **exits 0 without ever testing login**. A SKIP is not a pass.
> (Port 5000 is what prod `.env` sets; the unit's built-in default is 3000 —
> check `grep PORT .env` if the connection is refused.)

### Step 4.6 — Tell the family

Everyone is logged out and must sign in again on every device — phones
included. Give mom her new password and expect her to re-login.

---

## 5. Verification checklist

- [ ] `reset-password` printed `... reset successfully.`
- [ ] `AUTH_SECRET` **and** `NEXTAUTH_SECRET` in prod `.env` hold the same new value
- [ ] `systemctl --user restart bokli` run; `systemctl --user status bokli` shows active
- [ ] `npm run smoke:login` against `localhost:5000` reports `SUCCESS` (not `SKIP`)
- [ ] Any still-open browser session is bounced to `/login` on next request
- [ ] Mom informed she must log in again

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `BOKLI_DB_PATH is not set` | CLI does not read `.env`/`.env.local` (§2) | Export the path on the command line |
| `User "x" not found.` | Wrong username | Seeded logins are `mom` and `katte` |
| Everyone logged out, but the old password still works | Reset hit the wrong DB | Check which `BOKLI_DB_PATH` you exported |
| Still logged in after the reset | Secret not rotated, or service not restarted | Do §4.2–§4.4 |
| `smoke:login` prints `SKIP: Cloudflare Access gate detected` | Ran against the public hostname | Re-run with `TARGET_URL=http://localhost:5000` |
| Login loops back to `/login` after restart | `AUTH_URL`/cookie-secure mismatch, not the secret | See `resolveCookieSecure` in `src/auth/config.ts` |
| Service will not start after restart | Build-stamp `ExecStartPre` failed | See "Build Stamp Verification" in [`deploy/README.md`](../deploy/README.md) |

---

## 7. Related

- [`deploy/README.md`](../deploy/README.md) — env var contract, systemd unit, deploy flow
- [ADR-0003](adr/0003-credentials-auth.md) — credentials auth, 30-day JWT sessions, CLI-only reset
- [ADR-0000](adr/0000-dev-prod-db-split.md) — dev/prod DB split
- `src/cli/reset-password.ts`, `src/auth/config.ts`, `src/db/index.ts`
