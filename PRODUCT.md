# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary User (The Operator)**: Family food stall operator (primarily mom). Operates on an Android phone (Chrome browser) during evening closing at the stall or at home after a long physical workday. Job is to log the day's revenue and costs in under 2 minutes, replace the handwritten paper book, and verify that the month's takings balance without fatigue or arithmetic errors.
- **Secondary User (Administrator)**: Family administrator / son (Wilson). Manages server deployment, reviews long-term stall business health, and handles privileged exceptions (reopening closed months with a logged reason, resetting passwords via CLI).

## Product Purpose

Bokli is a web-based bookkeeping tool custom-built for a Malaysian family food stall to replace the daily paper book. It eliminates manual summation, arithmetic errors, and calculation fatigue while providing clear visibility into business health (Cash vs. TnG digital revenue, Gross Profit, Operating Expenses, and Net Profit). Success means closing the day takes under 2 minutes and monthly book closing provides complete peace of mind.

## Positioning

Unlike generic accounting software (which demands complex charts of accounts, double-entry bookkeeping, desktop layouts, and Western SaaS workflows) or spreadsheet apps (which suffer from clumsy phone input, broken formulas, and lack of locking), Bokli is purpose-built for the single food stall routine: dual Cash/TnG revenue entry, fixed daily cost categories, monthly operating expenses, warn-only reconciliation against physical cash and e-wallet on hand, and an explicit month-close freeze with paper parity.

## Operating Context

- **Physical Environment**: Busy food stall counter or late-night kitchen table. Operator uses one hand on a mobile phone, often with tired eyes and damp or oily fingers. Demands high visual contrast, clean typography, large 48px+ tap targets, and error-resistant numeric entry.
- **Hardware & Deployment**: Accessed via Android Chrome; hosted as a single systemd service on an Ubuntu server (repurposed laptop) running Node.js 22 and SQLite, accessed over local network and ngrok tunnel during development.
- **Operational Cadence**:
  - Daily: Operator logs one Daily Sheet per calendar date (strictly Asia/Kuala_Lumpur timezone, no future dates allowed) with Cash Revenue, TnG Revenue, and itemized Cost Lines.
  - Throughout Month: Operator or Admin logs fixed Operating Expenses (rental, utilities, wages, other) as they occur, monitoring live Gross and Net Profit previews.
  - Month-End Close: Operator reviews the monthly summary, enters cash on hand and TnG balance on hand, inspects warn-only Reconciliation differences, and explicitly locks the month.

## Capabilities and Constraints

- **Daily Sheet**: Strictly one sheet per calendar date in `Asia/Kuala_Lumpur`; future dates blocked. Holds Cash Revenue, TnG Revenue, and an itemized array of Cost Lines.
- **Cost Categories**: Fixed enum of daily costs: `restock` (进货), `gas` (煤气), `transport` (交通), `wages-daily` (员工工资), and `other` (其他). Note is strictly required when category is `other`.
- **Operating Expenses**: Monthly fixed overhead recorded per month (`rental`, `utilities`, `wages`, `other`).
- **Profit Calculation Engine**:
  - `Gross Profit` = Total Revenue (Cash + TnG) − Total Daily Costs
  - `Net Profit` = Gross Profit − Operating Expenses
- **Reconciliation**: Non-blocking check comparing (Cash on hand + TnG on hand) to Net Profit. Discrepancies generate a clear warning and require an explanatory note, but never block closing.
- **Month Close & Locking**: Explicit snapshot of month-to-date totals; freezes the month from regular edits. Reopening requires Admin authorization with an audit reason.
- **Financial Arithmetic**: Strictly Malaysian Ringgit (MYR). All money stored internally as 64-bit integer sen (`BigInt`) to eliminate floating-point inaccuracies. Decimal formatting applied solely at presentation.
- **Authentication**: Single-stall private family access via NextAuth v5 credentials provider. Two seeded users (`operator`, `admin`), bcrypt password hashes, ~30-day session cookies. No public registration.
- **Explicit Exclusions (Out of Scope for v1)**: No multi-currency/FX, no per-dish inventory or sales tracking, no receipt photo uploads, no multi-stall management, no automated auto-close cron jobs.

## Brand Commitments

- **Name**: Bokli (簿里 — family stall bookkeeping; playful homophone for broccoli 🥦).
- **Signature Brand Motif**: A modern, crisp **broccoli** (🥦) emblem—symbolizing fresh daily market produce, nourishing family livelihood, and the stall's daily culinary craft.
- **Visual Aesthetic & Vibe**: Clean light mode exclusively. Modern, business ops team daily-use aesthetic—crisp hairline borders, disciplined data grids, tactile 48px controls, and professional clarity without enterprise bloat.
- **Authoritative Domain Language (from CONTEXT.md)**:
  - *Daily Sheet* (avoid: daily entry, day book, transaction)
  - *Cash Revenue* (avoid: cash sales, cash income)
  - *TnG Revenue* (avoid: TNG, e-wallet revenue, online revenue)
  - *Daily Cost* (avoid: daily expense, variable cost)
  - *Cost Line* (avoid: cost entry, expense line)
  - *Operating Expense* (avoid: monthly cost, overhead, fixed cost)
  - *Gross Profit* (avoid: operating profit)
  - *Net Profit* (avoid: bottom line, final profit)
  - *Reconciliation* (avoid: balancing, closing check)
  - *Month Close* (avoid: month end, closing, freeze)
  - *Cost Category* (avoid: expense type, cost tag)
  - *Operator* (avoid: user, bookkeeper)
- **Voice & Tone**: Direct, functional, calm, warm. Practical stall language over corporate or financial jargon.

## Evidence on Hand

- `CONTEXT.md`: Defines product identity, target stall operation, and strict domain terminology rules.
- `.scratch/bokli/spec.md`: Authoritative specification covering user stories, calculations, data validation, and architecture.
- `docs/adr/0001-modular-monolith-nextjs-sqlite.md` through `0004-myr-minor-unit-money.md`: Technical decisions for architecture, month locking, credentials auth, and integer sen representation.
- `src/db/schema.ts` & `src/services/`: Drizzle SQLite database schema and fully tested business logic for sheets, expenses, month close, and dashboard.
- `app/dashboard/page.tsx`: Existing placeholder dashboard establishing basic calculation displays.

## Product Principles

- **Paper Parity Without Paper Friction**: Faithfully match the food stall's proven mental model of paper bookkeeping while eliminating manual addition, calculation mistakes, and messy scratchwork.
- **Under 2 Minutes, Zero Fatigue**: Every daily flow must be finishable within two minutes on a phone screen, with high-contrast UI, thumb-friendly tap targets, and minimal keyboard typing.
- **Warn, Don't Block**: Real stalls have coin discrepancies, delayed e-wallet settlements, and unexpected expenses. Reconciliation flags mismatches clearly but never prevents recording or month closing.
- **Freeze Means Frozen**: A closed month gives the family certainty that historical numbers are safe and stable, matching the finality of putting away last month's paper book.

## Accessibility & Inclusion

- **Touch Ergonomics**: All actionable buttons, links, inputs, and list rows must have at least 48×48px effective tap targets for fast, accurate mobile thumb interaction.
- **Visual Contrast & Lighting**: Strictly clean light mode with deep slate text (`#0f172a`) against crisp light surfaces, optimized for high legibility under both harsh stall fluorescent lights and bright daytime ambient glare.
- **Bilingual Interface**: Chinese-first (`zh`) primary labels for mom's direct comfort, supported by concise English (`en`) secondary labels.
