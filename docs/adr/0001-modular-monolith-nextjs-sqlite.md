# Modular monolith with Next.js, SQLite and Drizzle

We have 1-2 users, single old-laptop host, and need phone-first entry with minimal ops, so we will ship one Next.js TypeScript repo deployed as a single process with internal API routes and modules sharing one SQLite DB via Drizzle, instead of separate frontend and backend deploys.

## Considered Options

- Fully decoupled API + SPA in separate repos/deploys: rejected, doubles ops, CORS/auth, version skew for no benefit at 1 concurrent user.
- Classic server-rendered without internal API layer: rejected, loses seam for future dashboard/reporting modules and mobile use.
