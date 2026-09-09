---
name: Bokli
description: Clean light-mode modern business ops bookkeeping system for a family food stall
colors:
  primary: "#0f172a"
  primary-container: "#f1f5f9"
  surface: "#ffffff"
  surface-canvas: "#f8fafc"
  surface-subtle: "#f1f5f9"
  border: "#e2e8f0"
  border-strong: "#cbd5e1"
  text-primary: "#0f172a"
  text-secondary: "#334155"
  text-muted: "#64748b"
  brand-broccoli: "#15803d"
  brand-broccoli-light: "#dcfce7"
  cash-revenue: "#059669"
  cash-revenue-light: "#ecfdf5"
  tng-revenue: "#2563eb"
  tng-revenue-light: "#eff6ff"
  cost-amber: "#d97706"
  cost-amber-light: "#fffbeb"
  profit-positive: "#16a34a"
  profit-positive-deep: "#15803d"
  profit-positive-bg: "#f0fdf4"
  profit-positive-border: "#bbf7d0"
  cost-negative: "#dc2626"
  cost-negative-deep: "#b91c1c"
  cost-negative-bg: "#fef2f2"
  cost-negative-border: "#fecaca"
  status-closed-bg: "#dcfce7"
  status-closed-text: "#166534"
  status-reopened-bg: "#fef9c3"
  status-reopened-text: "#854d0e"
  status-open-bg: "#e0f2fe"
  status-open-text: "#075985"
  active-selection-bg: "#f0fdf4"
  active-selection-border: "#15803d"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.2
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.25
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "16px"
  nav-tab:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    height: "56px"
  action-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    padding: "16px"
    height: "64px"
  month-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
    height: "48px"
  metric-cell:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "12px"
  status-badge:
    backgroundColor: "{colors.status-closed-bg}"
    textColor: "{colors.status-closed-text}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
---

# Design System: Bokli

## Overview

**Creative North Star: "The Modern Food Stall Ops Deck" (西兰花记账 / 现代排档数字台)**

Bokli combines the disciplined, high-density utility of modern business operations tools with the warm, grounded reality of a Malaysian family food stall. Named after the stall's trusty ledger ("簿里") and carrying a fresh green **broccoli (🥦)** as its signature brand mascot, Bokli brings executive clarity to stall finances without enterprise bloat.

The design philosophy is strictly **Light Mode**, clean, and tactile. It feels like a high-end daily ops tool crafted for quick, repeatable, zero-fatigue workflow: crisp slate-bordered cards, pure white surfaces, deep slate ink for razor-sharp legibility, and energetic broccoli-green accents that signal healthy business growth.

**Key Characteristics:**
- **Strictly Light Mode & Glare-Resistant**: Clean `#ffffff` cards atop a cool `#f8fafc` canvas with crisp `#e2e8f0` structural hairlines, optimized for high visibility under fluorescent counter lamps or evening ambient lighting.
- **Ops Team Precision**: Tabular numerals, disciplined 12px metric grids, and structured semantic indicators rather than decorative SaaS fluff.
- **The Signature Broccoli Motif (🥦)**: A crisp green broccoli emblem anchoring the brand header, bringing warmth, freshness, and immediate personality to the family stall tool.
- **Hawker Ergonomics**: 48px+ minimum touch floors on all interactive buttons, category selectors, and keypad inputs for accurate one-thumb operation.
- **Bilingual Visual Clarity**: Bold Chinese primary typography paired with crisp secondary English translations.

## Colors

The palette is engineered for immediate semantic recognition across payment channels and operational states in pure light mode.

### Brand & Primary
- **Broccoli Forest Green** (`#15803d`): The signature brand color, representing stall vitality, active navigation tabs, and primary positive actions.
- **Broccoli Tint** (`#dcfce7`): Light fresh background tint for active states and brand accents.
- **Deep Slate Ink** (`#0f172a`): High-contrast primary text, metric headers, and crisp structural numerals.

### Neutral & Surfaces
- **Canvas Slate** (`#f8fafc`): Base canvas background providing glare-free, cool light contrast.
- **Surface White** (`#ffffff`): Elevated card containers, modal sheets, and active tile backgrounds.
- **Subtle Surface** (`#f1f5f9`): Metric cell backdrops, progress tracks, and inactive control backgrounds.
- **Hairline Border** (`#e2e8f0`): Crisp 1px borders defining cards, separators, and tab bars.
- **Strong Border** (`#cbd5e1`): Input perimeters, unselected tiles, and interactive borders.
- **Secondary Slate** (`#334155`): Secondary values, table labels, and helper descriptions.
- **Muted Slate** (`#64748b`): Inactive navigation icons, timestamps, and subtle notes.

### Semantic Payment & Finance Accents
- **Cash Emerald** (`#059669`, background tint: `#ecfdf5`): Physical cash intake, cash split bar, and cash totals.
- **TnG Blue** (`#2563eb`, background tint: `#eff6ff`): Touch 'n Go digital receipts, TnG split bar, and e-wallet totals.
- **Cost Amber** (`#d97706`, background tint: `#fffbeb`): Daily costs, cost category bars, and operational expense items.
- **Profit Forest Green** (`#16a34a` / `#15803d`, background tint: `#f0fdf4`): Positive net profit, healthy month indicators, and balanced reconciliation badges.
- **Loss Crimson Red** (`#dc2626` / `#b91c1c`, background tint: `#fef2f2`): Negative net profit, cost warnings, and reconciliation discrepancy badges.

### Status Tints
- **Closed Month** (Background: `#dcfce7`, Text: `#166534`): Locked, frozen month snapshot.
- **Reopened Month** (Background: `#fef9c3`, Text: `#854d0e`): Admin-reopened month requiring verification.
- **Open Month** (Background: `#e0f2fe`, Text: `#075985`): Active month in progress.

### Named Rules
**The Semantic Money Rule.** Money is never neutral black or gray when an outcome is conveyed: Cash is Emerald, TnG is Blue, Costs are Amber/Crimson, and Net Profit is Forest Green when positive or Crimson when negative.

**The Pure Light Mode Rule.** The application operates strictly in a bright, clean, high-contrast light theme. Dark mode surfaces or dark card containers are disallowed to maintain consistency with the physical paper book and high daytime/kitchen legibility.

## Typography

**Font Family:** Native System Sans-Serif Stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)

### Hierarchy (Mobile-Optimized Scale)
- **Display** (800 weight, 24px, 1.2 line-height): Top-level screen title, e.g., 🥦 Bokli 经营概览.
- **Headline** (900/800 weight, 20px, 1.25 line-height): Bottom-line Net Profit figures, live gross profit, and primary revenue card totals.
- **Title** (700 weight, 18px, 1.3 line-height): Section titles, metric card headers, and active date identifiers.
- **Body / Inputs** (400/600 weight, 16px, 1.5 line-height): Form inputs (preventing mobile zoom), standard notes, and descriptions.
- **Label** (600 weight, 14px, 1.4 line-height): Input field headers, cost category chips, button text, and trend metadata.
- **Caption/Badge** (700 weight, 13px, 1.2 line-height): Status badges, percentage pills, date navigation, and balance confirmations.

### Named Rules
**The Bilingual Pairing Rule.** Chinese terms lead with immediate visual weight, followed by parenthetical English translations (e.g. `总营业收入 (Revenue)`) to support family collaboration without creating clutter.

**The Large Number Rule.** Numerical currency figures must be rendered at least 2px larger and noticeably bolder than their associated text labels to allow at-a-glance comprehension.

## Layout

The layout is strictly phone-first and centered within a mobile viewport container (`maxWidth: 768px`) with `16px` outer gutters.

- **Grid & Rhythm**: Metric cards use a balanced two-column grid (`gridTemplateColumns: "1fr 1fr"`) with `12px` gaps.
- **Vertical Spacing**: Standard vertical module spacing of `20px` to `24px` between major logical sections (`<section>`).
- **Touch Target Floor**: All interactive controls, month tile links, and trend rows enforce a strict minimum tap height of `48px`.
- **Bottom Navigation**: Persistent 56px - 64px mobile navigation bar fixed at viewport bottom with safe-area padding.

## Elevation & Depth

Bokli employs a crisp, flat ops-deck aesthetic with hairline borders and subtle ambient depth.

### Shadow Vocabulary
- **Card Ambient** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04)`): Subtle separation between white card surfaces and canvas background.
- **Bottom Bar Elevation** (`box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.05)`): Fixed bottom navigation separation.

### Named Rules
**The Hairline Discipline Rule.** Structure is defined by crisp 1px borders (`#e2e8f0` and `#cbd5e1`) and tonal surface fills rather than heavy drop shadows or blurred glows.

## Shapes

- **Primary Cards**: `16px` border-radius (`rounded-xl`).
- **Month Tiles & Banners**: `12px` border-radius (`rounded-lg`).
- **Inner Metric Cells**: `8px` to `10px` border-radius (`rounded-md`).
- **Status Badges & Category Chips**: `6px` border-radius for badges; `9999px` (`full`) for pill-shaped category selectors and revenue ratio tracks.

## Components

### 1. App Header with Broccoli Emblem
- Crisp top app bar featuring the signature `🥦 Bokli` logo, active date/month badge, and logged-in user role indicator (`Operator` / `Admin`).

### 2. Bottom Navigation Bar
- 4 primary tabs: `[ 记账 Daily Sheet ]`, `[ 概览 Dashboard ]`, `[ 支出 Expenses ]`, `[ 结账 Month Close ]`.
- Minimum 56px height, high-contrast active state highlighted with Broccoli Forest Green (`#15803d`).

### 3. Daily Sheet Single-Sheet Form
- Cash Revenue & TnG Revenue input cards with large numeric font and `RM` prefix.
- Quick-tap Cost Category chips (`restock`, `gas`, `transport`, `wages-daily`, `other`).
- Sticky bottom summary and save bar showing live day's Gross Profit.

### 4. Month Navigation Tiles
- Horizontal scrolling carousel of past and current months.
- Active tile highlighted with Broccoli Forest Green border and soft green background.

### 5. Dual Revenue Split Bar
- Segmented 24px bar with Cash Emerald (`#059669`) and TnG Blue (`#2563eb`).

### 6. Net Profit Health Banner
- High-contrast summary card at the base of month metrics: Forest Green for profit, Crimson for loss.

## Do's and Don'ts

### Do:
- **Do** maintain pure Light Mode throughout the application with clean white cards and slate borders.
- **Do** feature the signature Broccoli (🥦) brand emblem in headers and primary brand moments.
- **Do** maintain a minimum `48px` tap target on all interactive buttons, inputs, chips, and links.
- **Do** format all currency as Malaysian Ringgit (MYR) with sen integers rendered to two decimal places via `formatMyr`.
- **Do** place Chinese primary terminology first, followed by secondary English parentheticals.
- **Do** use Cash Emerald (`#059669`) for cash intake and TnG Blue (`#2563eb`) for Touch 'n Go e-wallet transactions.

### Don't:
- **Don't** implement Dark Mode or dark card containers.
- **Don't** use generic SaaS purple gradients, glassmorphism, or heavy drop shadows.
- **Don't** nest cards inside cards more than one level deep.
- **Don't** use floating-point numbers for currency calculations; all calculations must use integer sen.
- **Don't** block month close on reconciliation mismatch; always warn and record the reason instead of failing.
