# Bokli v1 — Web bookkeeping for family food stall

## Problem Statement

My family runs a small food stall and does bookkeeping by hand in a paper book, spending about 1 hour every day. It is hard to see cash flow and profitability from paper. I want a phone-first web app that replaces the book for the Operator (primarily mom) and gives an overview of business health, accessible only to mom and myself.

## Solution

A single-deploy Next.js modular monolith with one shared SQLite database that covers the paper flow end to end: per-date Daily Sheet with Cash Revenue plus TnG Revenue and itemized Cost Lines, monthly Operating Expenses, live Gross Profit and Net Profit preview, explicit Month Close lock with admin reopen, warn-only Reconciliation of cash on hand plus TnG on hand against Net Profit, and a business overview dashboard. Chinese-first with English toggle, big tap targets for Android Chrome, credentials login with long-lived sessions, running on an Ubuntu Server old laptop via systemd, tested during development via localhost plus ngrok tunnel.

## User Stories

1. As an Operator, I want to log today's Cash Revenue and TnG Revenue in under 2 minutes on my phone, so that day-end entry stops taking an hour.
2. As an Operator, I want to add Daily Costs as Cost Lines with amount, Cost Category and optional note, so that I don't lose the restock versus gas breakdown.
3. As an Operator, I want Cost Category to be a fixed list with other plus note, so that I tap instead of typing and avoid typos.
4. As an Operator, I want only one Daily Sheet per date with no future dates in Asia/Kuala_Lumpur time, so that the book stays clean.
5. As an Operator, I want to correct today's Daily Sheet freely before Month Close, so that mistypes don't become permanent.
6. As an Operator, I want big numeric inputs and confirm steps that resist mispress, so that I don't accidentally save wrong amounts.
7. As an Operator, I want to record Operating Expenses for the month such as rental, utilities and wages anytime during the month, so that month-end isn't a rush.
8. As an Operator, I want to see month-to-date Revenue, Daily Costs, Gross Profit and estimated Net Profit update live as I enter, so that I know where the month stands without summing by hand.
9. As an Operator, I want to explicitly close the month to snapshot and lock it after review, so that Balanced Done means frozen like the paper book.
10. As an Admin, I want to reopen a closed month with a reason, so that late corrections are possible but visible.
11. As an Operator, I want to enter cash on hand and TnG on hand on the close screen and get a warning only on mismatch against Net Profit, so that Reconciliation doesn't block closing.
12. As an Operator, I want past Reconciliation results kept per month with diff and note, so that I can look back.
13. As an Operator, I want a dashboard with month tiles, daily revenue trend, cash versus TnG split and cost by category, so that I see business health at a glance.
14. As an Admin, I want the dashboard structure to allow adding or changing charts without rewriting bookkeeping, so that Q9 flexibility holds.
15. As an Operator, I want the UI in Chinese by default with an English toggle, so that mom reads comfortably and I can support in English.
16. As an Operator, I want to stay logged in on my phone for about 30 days, so that I don't type passwords daily.
17. As an Admin, I want only two seeded logins with no self-register and manual password reset, so that only family can access.
18. As an Admin, I want the app to run as one systemd service on the old laptop with a stable database path, so that it survives reboots and the future Hermes backup job knows where to read.
19. As an Admin, I want to test the phone UI via localhost plus ngrok tunnel before any custom domain exists, so that domain research doesn't block development.

## Implementation Decisions

- Architecture follows ADR-0001: modular monolith in one Next.js TypeScript repo, single process with internal API routes and in-memory module calls sharing one SQLite database via Drizzle, single deploy. Rejected fully decoupled separate frontend and backend deploys for double ops cost at one concurrent user.
- Auth follows ADR-0003: Auth.js credentials provider, two seeded family users, bcrypt hashes, roughly 30-day sessions, no self-register, manual CLI reset for v1.
- Money follows ADR-0004: store MYR-only minor units as sen in 64-bit integer, app-wide MYR, TypeScript Money value object with integer arithmetic, decimal conversion and formatting only at display. No per-row currency, no FX in v1; a currency check constrained to MYR is acceptable if a column is added for future-proofing.
- Domain language follows CONTEXT.md: Daily Sheet, Cash Revenue, TnG Revenue, Daily Cost, Cost Line, Cost Category, Operating Expense, Gross Profit as Revenue minus Daily Costs, Net Profit as Gross minus Operating Expenses, Reconciliation warn-only, Month Close lock, Operator.
- Daily Sheet constraints: unique per date, block future dates, timezone Asia/Kuala_Lumpur, amounts as sen integers, Cost Category enum of restock, gas, transport, wages-daily and other with note required when other, categories editable by Admin only.
- Operating Expense types: rental, utilities, wages and other, entered anytime during the month, included in live Net preview.
- Month Close follows ADR-0002: live preview during month plus explicit close that snapshots revenue, daily costs, gross, operating, net and reconciliation inputs and locks edits; after close edits require Admin reopen. No auto-close job in v1.
- Reconciliation: inputs cash on hand and TnG on hand on the close screen only, compare sum against Net Profit, warn-only mismatch with required note, keep per-month history. No daily reconciliation in v1.
- Corrections: editable until close by Operator, after close only Admin can reopen; no hard delete, corrections keep timestamps.
- UI: Tailwind with large tap targets, numeric-keypad-first, server-rendered pages for fast Android Chrome, next-intl with Chinese default and English toggle.
- Deploy contract: Ubuntu Server Node v22, Next standalone server behind one systemd unit, database at a stable path for the pending backup reader, development over localhost plus ngrok CLI interim tunnel. Custom domain and Hermes backup decoupled and pending, no code coupling beyond the database path.
- Proposed seams for testing (confirm): primary seam at the bookkeeping domain service covering Daily Sheet, Operating Expense, Month Close, Reconciliation and dashboard queries behind server functions; secondary seam at the auth session. Greenfield so no existing seams to reuse; one primary seam keeps tests at the highest point.

## Testing Decisions

- A good test checks external behaviour through the seam, not implementation details: given Daily Sheets plus Operating Expenses, Gross, Net, close lock and reconciliation warning behave as the Operator sees them.
- Modules to test: Money formatting and arithmetic, Daily Sheet validation including unique date and no-future rule, Gross and Net calculations, Month Close snapshot plus lock plus reopen gating, Reconciliation warn logic, dashboard aggregations, auth gating of bookkeeping actions.
- Prior art: none, greenfield. Start with service-level tests through the bookkeeping seam plus a few phone-flow page checks for entry under 2 minutes and mispress resistance. Avoid snapshot churn on Tailwind markup.

## Out of Scope

- Custom domain purchase and public DNS cutover, Cloudflare Tunnel hardening beyond ngrok interim.
- Hermes backup automation, Google Drive upload, encryption, retention enforcement and restore drills beyond the database path contract.
- Multi-currency, FX conversion, per-dish sales tracking, inventory, receipt photos, multi-stall support.
- Self-register, email password reset, OAuth or magic links, roles beyond Operator and Admin.
- Auto-close scheduler, daily reconciliation, hard-block on mismatch, delete semantics.
- Native apps or offline-first PWA with conflict sync.

## Further Notes

- Paper parity matters: live preview replaces mental sums, Close replaces the last-day sum plus Balanced Done moment.
- Backup reader contract is the only coupling to the pending Hermes work: single SQLite file, WAL mode, read via online backup copy so evening entry never locks.
- Tracker for this work is local markdown under `.scratch/bokli/`; status `ready-for-agent` marks agent-grabbable tickets.
