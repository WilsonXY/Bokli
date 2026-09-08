---
name: Bokli
description: Phone-first web bookkeeping system for a family food stall
colors:
  primary: "#111827"
  surface: "#ffffff"
  surface-dim: "#f9fafb"
  surface-muted: "#f3f4f6"
  border: "#e5e7eb"
  border-strong: "#d1d5db"
  text-primary: "#111827"
  text-secondary: "#4b5563"
  text-muted: "#6b7280"
  cash-revenue: "#10b981"
  tng-revenue: "#3b82f6"
  cost-amber: "#f59e0b"
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
  active-selection-bg: "#eff6ff"
  active-selection-border: "#2563eb"
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
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
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
  month-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
    height: "48px"
  month-tile-active:
    backgroundColor: "{colors.active-selection-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
    height: "48px"
  metric-cell:
    backgroundColor: "{colors.surface-dim}"
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

**Creative North Star: "The Food Stall Ledger" (大排档的数字化账本)**

Bokli translates the time-honored routine of a Malaysian hawker stall paper ledger into an uncluttered, high-legibility mobile web experience. The system is designed for quick, confident scanning and recording under real-world kitchen constraints—steamy counters, fluorescent or evening stall lighting, and tired operators tapping on Android Chrome with one hand.

The visual language rejects SaaS decoration, nested cards, and frivolous animations in favor of honest utility, purposeful color coding, and generous tactile tap targets. Financial clarity takes precedence over ornamentation: critical monetary metrics stand out with bold, crisp numerals, while secondary context remains supportive without cluttering the screen.

**Key Characteristics:**
- **Hawker Ergonomics**: 48px minimum touch height on interactive elements for effortless single-hand thumb tapping.
- **Semantic Money Coding**: Unmistakable functional color distinctions—Emerald for physical Cash, Bright Blue for TnG digital collections, Amber for daily expenses, and Forest Green / Crimson for net profit or loss.
- **Bilingual Readability**: Prominent Chinese primary headings paired with secondary English helper labels for clear family cooperation.
- **Calm, High-Contrast Palette**: Clean white surfaces over subtle cool-gray canvas backgrounds, bordered with delicate hairlines rather than heavy drop shadows.

## Colors

The color palette is strictly functional, establishing immediate recognition between payment channels and financial states.

### Primary
- **Deep Ink Black** (`#111827`): Used for primary headings, metric values, and prominent structural text.

### Neutral
- **Off-White Canvas** (`#f9fafb`): The base page background providing soft, glare-resistant contrast.
- **Card Surface White** (`#ffffff`): Elevated card containers and selectable tile surfaces.
- **Subtle Gray Surface** (`#f3f4f6`): Progress bar tracks, category bar backgrounds, and divider borders.
- **Hairline Border Gray** (`#e5e7eb`): Standard 1px perimeter border for cards and section separators.
- **Medium Border Gray** (`#d1d5db`): Unselected month tile borders and secondary outlines.
- **Secondary Slate Text** (`#4b5563`): Sub-metrics, helper notes, and table content.
- **Muted Caption Gray** (`#6b7280`): Timestamps, secondary labels, and descriptive captions.

### Semantic & Functional Accents
- **Cash Emerald** (`#10b981`): Physical cash collections, cash ratio bars, and cash breakdown accents.
- **TnG Blue** (`#3b82f6`): Touch 'n Go digital receipts, TnG ratio bars, and digital collection accents.
- **Active Blue** (`#2563eb`): High-visibility border and highlight for currently selected month tiles.
- **Cost Amber** (`#f59e0b`): Daily operational cost breakdown bars and expense indicators.
- **Profit Forest Green** (`#16a34a` / `#15803d`): Net profit figures, positive balances, and balanced reconciliation indicators.
- **Loss Crimson Red** (`#dc2626` / `#b91c1c`): Daily costs, operating expenses, net loss figures, and reconciliation warnings.

### Status Tints
- **Closed Badge Green** (Background: `#dcfce7`, Text: `#166534`): Confirmed, frozen month close status.
- **Reopened Badge Yellow** (Background: `#fef9c3`, Text: `#854d0e`): Admin-reopened month requiring review.
- **Open Badge Sky** (Background: `#e0f2fe`, Text: `#075985`): Active, open month in progress.

### Named Rules
**The Semantic Money Rule.** Money is never generic black or gray when an outcome is conveyed: Revenue is categorized by payment medium (Emerald for Cash, Blue for TnG), costs are Crimson, and net balance is Forest Green for profit and Crimson for loss.

**The No-Gradient Rule.** Gradients are forbidden across all surfaces, cards, buttons, and progress indicators. Solid, high-contrast tints ensure instantaneous readability in bright outdoor stall environments.

## Typography

**Display Font:** System UI font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
**Body Font:** System UI font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
**Label/Mono Font:** System UI font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)

**Character:** Clean, rapid-rendering system sans-serif prioritizing instant font loading with zero network overhead, exceptional Chinese character legibility, and high-density tabular numbers.

### Hierarchy
- **Display** (800 weight, 24px, 1.2 line-height): Top-level screen title, e.g. 经营概览 (Business Overview).
- **Headline** (900 weight, 22px / 800 weight, 20px, 1.25 line-height): Primary monetary takeaways (Net Profit) and section header cards.
- **Title** (800/700 weight, 16px - 17px, 1.3 line-height): Section titles, metric card numbers, and active month identifiers.
- **Body** (400 weight, 14px, 1.5 line-height): Standard body text, bilingual descriptions, and empty state notices.
- **Label** (600 weight, 12px - 13px, 1.4 line-height): Metric card labels, cost category names, and trend metadata.
- **Caption/Badge** (600/700 weight, 11px, 1.2 line-height): Status badges, percentage pills, and balance confirmations.

### Named Rules
**The Bilingual Pairing Rule.** Chinese terms lead with immediate visual weight, followed by parenthetical English translations (e.g. `总营业收入 (Revenue)`) to support family collaboration without creating clutter.

**The Large Number Rule.** Numerical currency figures must be rendered at least 2px larger and noticeably bolder than their associated text labels to allow at-a-glance comprehension.

## Layout

The layout is strictly phone-first and centered within a mobile viewport container (`maxWidth: 768px`) with `16px` outer gutters.

- **Grid & Rhythm**: Metric cards use a balanced two-column grid (`gridTemplateColumns: "1fr 1fr"`) with `12px` gaps.
- **Vertical Spacing**: Standard vertical module spacing of `20px` to `24px` between major logical sections (`<section>`).
- **Touch Target Floor**: All interactive controls, month tile links, and trend rows enforce a strict minimum tap height of `48px`.
- **Horizontal Scrolling**: Month navigation tiles are arranged in a horizontal touch-scrolling row with visible momentum and touch affordance.

## Elevation & Depth

Bokli employs a clean, flat aesthetic with hairline borders and subtle ambient depth. Heavy elevation drops and floating layered cards are avoided.

### Shadow Vocabulary
- **Card Ambient** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05)`): Applied to primary card containers to softly separate white surfaces from the cool `#f9fafb` canvas background.
- **Tile Sub-Ambient** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05)`): Applied to unselected month navigation tiles.

### Named Rules
**The Flat-By-Default Rule.** Surfaces lie flat on the canvas. Visual hierarchy is established via 1px border definition (`#e5e7eb`), tonal background fills, and bold typography rather than stacking shadow layers.

## Shapes

- **Primary Cards**: `16px` border-radius (`rounded-xl`) creates comfortable, modern card boundaries.
- **Month Tiles & Banners**: `12px` border-radius (`rounded-lg`) for interactive tiles and highlight profit banners.
- **Inner Metric Cells**: `8px` to `10px` border-radius for nested stat cells inside cards.
- **Status Badges & Pills**: `6px` border-radius for compact tag badges; `9999px` (`full`) for pill-shaped close indicators and ratio bars.

## Components

### Month Navigation Tiles
- **Character**: Scrollable horizontal ribbon of past and active months providing quick historical review.
- **Shape**: `12px` radius, `minWidth: 150px`, `minHeight: 48px`, padding `12px`.
- **Default State**: Background `#ffffff`, border `1px solid #d1d5db`, shadow `0 1px 2px rgba(0,0,0,0.05)`.
- **Active State**: Background `#eff6ff`, border `2px solid #2563eb`.
- **Content**: Month string (15px bold), status badge, Net Profit with color thresholding, and reconciliation icon.

### Metric Grid Card
- **Character**: Structured summary container displaying the four pillars of stall bookkeeping: Revenue, Daily Costs, Gross Profit, and Operating Expenses.
- **Shape**: `16px` radius, `1px solid #e5e7eb`, padding `16px`, background `#ffffff`.
- **Inner Cells**: 2-column grid, background `#f9fafb`, radius `10px`, padding `12px`.

### Net Profit Highlight Banner
- **Character**: High-contrast summary band at the base of the monthly overview delivering the bottom-line health check.
- **Shape**: `12px` radius, padding `14px`, flex layout with space-between alignment.
- **Positive (Profit)**: Background `#f0fdf4`, border `1px solid #bbf7d0`, text `#15803d`.
- **Negative (Loss)**: Background `#fef2f2`, border `1px solid #fecaca`, text `#b91c1c`.

### Dual Revenue Split Bar (Cash vs TnG)
- **Character**: Visual representation of stall revenue intake channels.
- **Bar Height**: `24px` height, `12px` radius, background `#e5e7eb`, smooth `width 0.3s ease` transitions.
- **Left Accent (Cash)**: `#10b981` (Cash Revenue).
- **Right Accent (TnG)**: `#3b82f6` (Touch 'n Go digital).
- **Stat Cards**: 2-column breakdown with 4px colored left indicator borders.

### Cost Category Breakdown
- **Character**: List of operational expense categories with proportional distribution bars.
- **Row**: Flex space-between with category name, amount in MYR, and percentage.
- **Progress Track**: `8px` height, `4px` radius, track `#f3f4f6`, bar `#f59e0b`.

### Daily Trend Row
- **Character**: Chronological list of daily sheets logged in the active month.
- **Shape**: `8px` radius, `minHeight: 48px`, padding `10px 12px`, background `#f9fafb`.
- **Content**: Left: Date (bold) + Cash/TnG breakdown subtext. Right: Total daily revenue in `#16a34a`.

### Status Badges
- **Shape**: `6px` radius, padding `2px 6px` or `4px 10px` (pill), font-size `11px` - `12px`, font-weight `600` - `700`.
- **Variants**: Closed (Green `#dcfce7`/`#166534`), Reopened (Yellow `#fef9c3`/`#854d0e`), Open (Sky `#e0f2fe`/`#075985`).

## Do's and Don'ts

### Do:
- **Do** maintain a minimum `48px` tap target on all interactive controls, buttons, links, and inputs.
- **Do** format all currency as Malaysian Ringgit (MYR) with sen integers rendered to two decimal places via `formatMyr`.
- **Do** place Chinese primary terminology first, followed by secondary English parentheticals.
- **Do** use Cash Emerald (`#10b981`) for cash intake and TnG Blue (`#3b82f6`) for Touch 'n Go e-wallet transactions.
- **Do** color code net financial results: `#16a34a` for positive net profit, `#dc2626` for negative net loss.
- **Do** preserve the canonical single-column mobile container with `maxWidth: 768px`.

### Don't:
- **Don't** use generic SaaS purple-to-blue gradients, glassmorphism, or heavy drop shadows.
- **Don't** nest cards inside cards more than one level deep.
- **Don't** use floating-point numbers for currency calculations; all calculations must use integer sen.
- **Don't** introduce non-standard domain terms (e.g. do not use "daily expense", "day book", "balancing", "e-wallet revenue").
- **Don't** block month close on reconciliation mismatch; always warn and record the reason instead of failing.
- **Don't** require external web font network requests; rely strictly on clean system font stacks for instantaneous rendering.
