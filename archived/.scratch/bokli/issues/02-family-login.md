# 02: Family login

**What to build:** Credentials login for Operator and Admin with two seeded family logins, long-lived phone session, no self-register, and manual password reset.

**Blocked by:** 01-scaffold-modular-monolith.

**Status:** completed

- [x] Mom and admin can log in with seeded credentials and stay logged in about 30 days on phone Chrome
- [x] No self-register route exists and bookkeeping routes reject anonymous access
- [x] Admin can reset a password via CLI without email dependency
