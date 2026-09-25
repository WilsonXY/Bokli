# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Operator (Mom / Stall Operators)**: Records daily business figures (Cash Revenue, TnG Revenue, Daily Costs) at the stall, often one-handed on mobile during or after a busy shift, and locks (closes) a completed month.
- **Admin (Katte)**: Reviews overall stall health, monitors gross/net profit, verifies reconciliation between cash/TnG and net profit, may also lock a month, and is the only role that can reopen a locked month.

## Product Purpose
Web-based bookkeeping for a Malaysian family food stall to replace the physical paper ledger ("簿里") and deliver clear business health insights. Success means effortless daily logging with zero arithmetic stress, clear revenue channel tracking, and trustworthy monthly close.

## Positioning
A purpose-built hawker stall ledger that bridges the simplicity of a paper notebook with the rigor of modern financial software. Unlike generic accounting tools, Bokli matches the real-world operational rhythms of a food stall: daily cash and Touch 'n Go intake, immediate ingredient restocking costs, and monthly fixed overheads.

## Operating Context
Used primarily on mobile devices inside bright, fast-paced food stall environments where grease, glare, and rush hours demand clear visual feedback and large touch targets (minimum 48px tap targets). Also used on desktop/tablet for monthly review and month close.

## Capabilities and Constraints
- **Daily Sheet**: Records date-specific Cash Revenue, Touch 'n Go Revenue, and dynamic Cost Lines (ingredient restock, gas, transport, other).
- **Operating Expenses**: Monthly fixed expenses (rent, utilities, salaries, maintenance).
- **Dashboard**: High-level financial overview calculating Gross Profit (Revenues - Daily Costs) and Net Profit (Gross Profit - Operating Expenses).
- **Month Close**: Formal review and locking of monthly financial snapshots, with reconciliation warning check between physical funds and Net Profit.
- **Bilingual Interface**: Chinese primary terms paired with English secondary subtitles for family collaboration.
- **Currency Standard**: All monetary values represented and computed in integer sen (MYR) with no floating-point rounding errors.
- **Tech Stack**: Next.js App Router, Tailwind CSS, SQLite with Drizzle ORM, NextAuth credentials auth.

## Brand Commitments
- **Name**: Bokli (簿里 — literally "inside the ledger").
- **Mascot**: The friendly green broccoli emblem (🥦), representing fresh ingredients and business vitality.
- **Strict Light Mode**: Glare-resistant light canvas for kitchen and outdoor stall readability.
- **Semantic Financial Colors**: Cash Emerald (#059669), TnG Royal Blue (#2563eb), Cost Amber (#d97706), Profit Forest Green (#16a34a), and Loss Crimson (#dc2626).

## Evidence on Hand
Fully functional codebase with 22 test suites and 293 passing unit/integration tests. Working UI components in `src/components/` (`DailySheetForm`, `DashboardView`, `ExpensesView`, `MonthCloseView`, `AppShell`, `CalendarPopover`, `MonthSelectorDropdown`) and routes in `app/`.

## Product Principles
1. **Kitchen Ergonomics Over Decorative SaaS**: 48px+ touch floors, clear button boundaries, and zero micro-taps.
2. **Tabular Financial Legibility**: Numbers are bold, high-contrast, and spaced with tabular numerals so columns and totals align instantly.
3. **Bilingual Family Harmony**: Chinese terms lead for familiarity, with clean English context for cross-generational clarity.
4. **Resilient Simplicity**: Never block operators with rigid accounting errors; warn gracefully and protect data integrity.
