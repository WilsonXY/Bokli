# Credentials auth with seeded family logins

We have only mom and admin, no email infra, and need long-lived phone sessions on a private host, so we will use Auth.js credentials with bcrypt hashes, two seeded users, 30-day sessions, no self-register, and manual CLI password reset, instead of OAuth or magic links.
