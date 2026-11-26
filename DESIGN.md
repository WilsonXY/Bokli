---
name: Bokli
description: Web-based bookkeeping for a family food stall to replace the paper book and show business health.
colors:
  primary: "#15803d"
  primary-dark: "#166534"
  primary-light: "#e9f6ee"
  ink-primary: "#161614"
  ink-secondary: "#46453f"
  ink-muted: "#737168"
  surface-canvas: "#f7f6f3"
  surface-card: "#ffffff"
  surface-subtle: "#f0efe9"
  border-subtle: "#e5e3dc"
  border-strong: "#d1cec4"
  channel-cash: "#047857"
  channel-cash-light: "#ecfdf5"
  channel-tng: "#1d4ed8"
  channel-tng-light: "#eff6ff"
  finance-cost: "#b45309"
  finance-cost-light: "#fffbeb"
  finance-profit: "#15803d"
  finance-profit-light: "#f0fdf4"
  finance-loss: "#dc2626"
  finance-loss-light: "#fef2f2"
typography:
  fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif"
  baseWeight: 500
rounded:
  md: "12px"
  lg: "16px"
  full: "9999px"
---

# Design System: Bokli (Overhaul)

## Overview

Bokli ("簿里") is an operational bookkeeping web application for a Malaysian family food stall. Its interface combines the architectural restraint and crisp light-paper clarity of modern financial tools with hawker-stall ergonomics (minimum 44–48px touch targets, instant numeric scannability, zero decorative clutter).

## Themes
- **Bright Mode (Default):** Warm porcelain-stone canvas (`#f7f6f3`), crisp white ledger cards (`#ffffff`), hairline borders (`#e5e3dc`), warm near-black ink (`#161614`).
- **Dark Mode (Settings toggle):** Warm obsidian canvas (`#111110`), charcoal cards (`#191917`), subtle hairlines (`#2e2d29`), warm off-white ink (`#f3f2ee`), persisted in `localStorage` (`bokli_theme`).
- Theme and Language switches live exclusively in `/settings` to keep daily operational screens uncluttered.

## Typography
- **Font Family:** `Noto Sans SC` (loaded via `next/font/google`) with Medium (`500`) as the default UI weight, `600` for section/control labels, and `700` for page headlines and primary monetary figures.
- **Tabular Numerals:** All currency values (`RM XX.XX`) and ledger dates use `tabular-nums`.

## Navigation & Responsive Layout
- **Desktop (`>= 1024px`):** Fixed left sidebar (`244px`) with primary routes (`Overview`, `Daily Sheet`, `Expenses`, `Month Close`) and bottom utility links (`Settings`, `Sign Out`), paired with a spacious multi-column bento workspace (`max-w-5xl`).
- **Mobile & Tablet (`< 1024px`):** Clean minimal brand header with a single Settings gear shortcut, paired with a 5-tab persistent bottom navigation bar with active top indicator bar.

## Semantic Money Colors
- Cash Revenue: Emerald (`#047857` light / `#34d399` dark)
- TnG Revenue: Cobalt Blue (`#1d4ed8` light / `#60a5fa` dark)
- Daily Costs: Warm Amber (`#b45309` light / `#fbbf24` dark)
- Net Profit: Forest Green (`#15803d` light / `#4ade80` dark)
- Loss / Destructive: Crimson (`#dc2626` light / `#f87171` dark)
- Cost Categories (ranking bars + icon tiles): Cyan (Restock `#0891b2` / `#22d3ee`), Pink (Gas `#db2777` / `#f783c0`), Steel Blue (Transport `#4a7aa8` / `#4682b4`), Moss Olive (Wages `#4d7c0f` / `#bef264`), Umber (Maintenance `#713f12` / `#fdba74`), Stone (Other `#78716c` / `#d6d3d1`). Operating Expense icons reuse them: Rental cyan, Utilities steel blue, Wages pink. Never saturated cobalt, emerald, amber or crimson (reserved for TnG, Cash, Daily Costs and Loss; `src/lib/theme.test.ts` enforces the distance). The dominant categories (Restock, Rental) sit at least 25° of hue away from Cash and TnG so neighbouring cards never show two near-identical blues and strictly zero violet/lavender.
