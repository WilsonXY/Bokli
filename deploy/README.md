# Bokli Deployment Guide (Ubuntu Server & systemd)

This document provides the deployment guide and environment variable contract for Bokli on Ubuntu Server (Node v22).

---

## 1. Overview & Architecture

Bokli is deployed as a single-process modular monolith (per [ADR-0001](file:///home/penguin/projects/bokli/docs/adr/0001-modular-monolith-nextjs-sqlite.md)):
- **Runtime:** Ubuntu Server with Node.js v22 (LTS) executing Next.js in standalone mode (`.next-prod/standalone/server.js`). Production builds output to `.next-prod` so running `next dev` cannot clobber or delete production standalone artifacts.
- **Process Manager:** `systemd` user service (`systemctl --user`), running under the host user account (e.g. `penguin`).
- **Reboot Survival:** Enabled via `loginctl enable-linger $USER`, allowing the user service to boot automatically and persist across logouts and server restarts.
- **Database:** Single SQLite file with Write-Ahead Logging (`WAL` mode). The filesystem location is governed by `BOKLI_DB_PATH`, serving as the stable coupling point for the future Hermes backup job (ADR-0001, Spec User Story 18).
- **Authentication:** Credentials auth (Auth.js / NextAuth v5) using bcrypt password hashes and 30-day JWT sessions ([ADR-0003](file:///home/penguin/projects/bokli/docs/adr/0003-credentials-auth.md)).

---

## 2. Environment Variable Contract

All runtime configuration is managed via environment variables. The application loads defaults when variables are unset, and reads overrides from `.env` in the project root or the `systemd` unit environment.

A template is provided in [`.env.example`](file:///home/penguin/projects/bokli/.env.example).

| Variable | Required in Prod? | Default | Description & Contract |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | HTTP port the Next.js standalone server listens on. Bound to `0.0.0.0` (all interfaces). |
| `NODE_ENV` | Yes | `production` | Set to `production` in production deployment. Enables secure cookie flags and optimized runtime. |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | **Yes** | Built-in fallback | High-entropy secret key (min 32 characters) used to sign and encrypt session tokens. Generate with `openssl rand -base64 32`. Both names are accepted interchangeably. |
| `AUTH_URL` / `NEXTAUTH_URL` | **Yes** | `http://localhost:3000` | Canonical public base URL for NextAuth redirects, callbacks, and cookie domains. For LAN access, set to `http://<LAN_IP>:3000` (e.g. `http://192.168.0.100:3000`). For tunnels, set to `https://<subdomain>.ngrok-free.app`. |
| `BOKLI_DB_PATH` | **Yes** | `<repo>/data/bokli.db` | Absolute filesystem path to the SQLite database file. **Critical:** Must be an absolute path (e.g. `/home/penguin/projects/bokli/data/bokli.db`) to ensure stability across working directory changes and as the coupling point for Hermes backups. |
| `BOKLI_MOM_PASSWORD` | Recommended | `mom-bokli-default-pass` | Initial password used when executing `npm run db:seed` for the `mom` account (`Operator` role). |
| `BOKLI_ADMIN_PASSWORD` | Recommended | `katte-bokli-default-pass` | Initial password used when executing `npm run db:seed` for the `katte` account (`Admin` role). |

### CLI Password Reset Contract
Family logins do not have self-registration or email recovery. Passwords can be reset at any time via the command-line utility:
```bash
npm run reset-password -- <username>
# Example:
npm run reset-password -- mom
npm run reset-password -- katte
```

---

## 3. Step-by-Step Installation on Ubuntu Server

### Step 3.1: System Requirements
Ensure Ubuntu Server has Node.js v22 and npm installed:
```bash
node -v   # Must be v22.x (e.g. v22.22.1)
npm -v    # npm v10+
```

### Step 3.2: Clone / Place Repository
Place the repository at a persistent path under the user's home directory (standard path: `~/projects/bokli`):
```bash
cd ~/projects/bokli
```

### Step 3.3: Configure Environment Variables
Copy `.env.example` to `.env` and set production secrets:
```bash
cp .env.example .env
chmod 600 .env
```
Edit `.env`:
```ini
PORT=3000
NODE_ENV=production
AUTH_SECRET=<output of openssl rand -base64 32>
NEXTAUTH_SECRET=<same as AUTH_SECRET>
AUTH_URL=http://<server-lan-ip>:3000
NEXTAUTH_URL=http://<server-lan-ip>:3000
BOKLI_DB_PATH=/home/penguin/projects/bokli/data/bokli.db
BOKLI_MOM_PASSWORD=<secure-password-for-mom>
BOKLI_ADMIN_PASSWORD=<secure-password-for-admin>
```

### Step 3.4: Install Dependencies & Build Application
```bash
# Clean install of dependencies
npm ci

# Build the Next.js application (generates .next-prod/standalone and copies static assets)
npm run build
```

### Step 3.5: Initialize Database & Seed Family Accounts
Run database schema migrations and seed the initial operator/admin logins:
```bash
# Apply migrations to the SQLite database specified by BOKLI_DB_PATH
npm run db:migrate

# Seed family users ('mom' and 'katte') idempotently
npm run db:seed
```

### Step 3.6: Install the systemd User Service
The systemd unit [`deploy/bokli.service`](file:///home/penguin/projects/bokli/deploy/bokli.service) runs under the user's systemd instance.

1. Create the systemd user service directory if it does not exist:
   ```bash
   mkdir -p ~/.config/systemd/user
   ```

2. Copy the unit file:
   ```bash
   cp deploy/bokli.service ~/.config/systemd/user/bokli.service
   ```

3. Reload user daemon configuration:
   ```bash
   systemctl --user daemon-reload
   ```

### Step 3.7: Enable Reboot Survival (User Lingering)
By default on Ubuntu, user systemd services only run while a user session is active. To make the service start automatically at boot and survive user logout/reboots:
```bash
loginctl enable-linger $USER
```
*(Verify with `loginctl show-user $USER --property=Linger` — should show `Linger=yes`)*.

### Step 3.8: Enable and Start the Service
```bash
systemctl --user enable --now bokli.service
```

---

## 4. Operational Runbook

### Service Management
- **Check service status:**
  ```bash
  systemctl --user status bokli.service
  ```
- **Stream live logs (stdout/stderr):**
  ```bash
  journalctl --user -u bokli.service -f
  ```
- **Restart the application (e.g. after code pull or env changes):**
  ```bash
  systemctl --user restart bokli.service
  ```
- **Stop the service:**
  ```bash
  systemctl --user stop bokli.service
  ```

### Health Check
Verify the server is running and responding:
```bash
curl -I http://localhost:3000/
# Should return HTTP/1.1 200 OK
```

---

## 5. Database & Backup Contract (Hermes Coupling)

- **Location:** The database file is located at the path defined by `BOKLI_DB_PATH` (default: `~/projects/bokli/data/bokli.db`).
- **Journal Mode:** `WAL` (Write-Ahead Logging). During operation, `bokli.db-wal` and `bokli.db-shm` files may exist beside `bokli.db`.
- **Backup Readers (Hermes):** The future Hermes backup job reads directly from this stable path. To take safe, non-blocking online backups while the stall is operating:
  ```bash
  sqlite3 /home/penguin/projects/bokli/data/bokli.db ".backup /path/to/backup/bokli-$(date +%F).db"
  ```
  This creates an atomic snapshot without blocking active reads or writes by the operator.
