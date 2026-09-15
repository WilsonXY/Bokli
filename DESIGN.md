---
name: Bokli
description: Web-based bookkeeping for a family food stall to replace the paper book and show business health.
colors:
  primary: "#15803d"
  primary-dark: "#166534"
  primary-light: "#dcfce7"
  ink-primary: "#0f172a"
  ink-secondary: "#334155"
  ink-muted: "#64748b"
  surface-canvas: "#f8fafc"
  surface-card: "#ffffff"
  surface-subtle: "#f1f5f9"
  border-subtle: "#e2e8f0"
  border-strong: "#cbd5e1"
  channel-cash: "#059669"
  channel-cash-light: "#ecfdf5"
  channel-tng: "#2563eb"
  channel-tng-light: "#eff6ff"
  finance-cost: "#d97706"
  finance-cost-light: "#fffbeb"
  finance-profit: "#16a34a"
  finance-profit-light: "#f0fdf4"
  finance-loss: "#dc2626"
  finance-loss-light: "#fef2f2"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: "1.2"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "1.25"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "1.3"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.4"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "1.3"
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
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
---

# Design System: Bokli (Incumbent Baseline)

## Overview

**Creative North Star: "The Modern Food Stall Ops Deck"**

Bokli is an operational bookkeeping interface built for a Malaysian family food stall, replacing physical paper ledgers ("簿里") with digital clarity. The application serves operators (primarily stall-running parents) who record daily cash and Touch 'n Go revenues, track kitchen restocking and operating costs, and perform month-close reconciliations.

The incumbent visual system emphasizes pure light-mode utility, high tactile feedback with minimum 48px touch targets, bilingual Chinese-first terminology with English subtitles, and clear semantic color assignments representing money and business health.

**Key Characteristics:**
- **Strict Light Mode:** Glare-resistant #f8fafc canvas with crisp white cards and #e2e8f0 border hairlines suited for bright food stall environments.
- **Bilingual Framing:** Primary Chinese terminology accompanied by secondary English subtitles.
- **Hawker Ergonomics:** 48px minimum touch dimensions for one-thumb entry during hurried stall operations.
- **Semantic Money Coding:** Green for cash and profit, blue for TnG e-wallet, amber for costs, crimson for losses.
- **Signature Broccoli Motif:** The 🥦 broccoli icon acts as the friendly mascot anchoring stall pride.

## Colors

The palette uses a disciplined semantic structure where financial meaning maps directly to hue roles.

### Primary
- **Broccoli Forest Green** (#15803d): Core brand accent representing business vitality, positive profit, and primary actions.
- **Broccoli Dark** (#166534): Hover and active states for primary actions; text color for closed month indicators.
- **Broccoli Light** (#dcfce7): Soft background fill for success tags and brand badges.

### Secondary
- **TnG Blue** (#2563eb): Touch 'n Go e-wallet payment channel indicator.
- **TnG Blue Light** (#eff6ff): Background tint for TnG amount fields and badges.

### Tertiary
- **Cost Amber** (#d97706): Operating cost lines, restocking warnings, and reopened state flags.
- **Cost Amber Light** (#fffbeb): Background tint for cost breakdowns and warning notices.
- **Loss Crimson** (#dc2626): Negative net profit, expense deductions, and error validation alerts.

### Neutral
- **Deep Slate Ink** (#0f172a): High-contrast primary text and major numerical metrics.
- **Secondary Ink** (#334155): Section titles, subheadings, and secondary labels.
- **Muted Ink** (#64748b): Meta timestamps, helper text, and inactive tab labels.
- **Surface Card** (#ffffff): Background for interactive cards, modals, and input fields.
- **Surface Canvas** (#f8fafc): Neutral off-white page background.
- **Surface Subtle** (#f1f5f9): Chip backgrounds, subtle row striping, and divider pills.
- **Border Subtle** (#e2e8f0): 1px structural dividing lines and card borders.
- **Border Strong** (#cbd5e1): Input outlines and high-emphasis separators.

### Named Rules
**The Semantic Money Rule.** Money is never generic neutral text when an outcome or channel is conveyed: Cash is Emerald (#059669), TnG is Blue (#2563eb), Daily Costs are Amber (#d97706), and Net Profit is Forest Green (#16a34a) when positive or Crimson (#dc2626) when negative.

**The Pure Light Mode Rule.** The stall dashboard operates strictly in high-contrast light mode to ensure rapid scanability under bright kitchen and stall lighting.

## Typography

**Display & Body Font:** System Sans Stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`)

**Character:** Clean, highly legible system font stack optimized for rapid legibility and instant rendering without web font network latency.

### Hierarchy
- **Display** (800 weight, 20-22px, line-height 1.2): Top-level screen titles and modal headers.
- **Headline** (700 weight, 18-20px, line-height 1.25): High-impact monetary figures and card KPI numbers.
- **Title** (700 weight, 14-16px, line-height 1.3): Section headers, card titles, and primary field labels.
- **Body** (400 weight, 13-14px, line-height 1.4): Explanatory descriptions, notes, and table text.
- **Label** (600 weight, 11-12px, line-height 1.3): Field captions, bilingual sub-labels, and tag badges.

### Named Rules
**The Large Number Rule.** Numerical currency figures must be rendered at least 2px larger and noticeably bolder than their accompanying text labels to allow instant reading.

**The Bilingual Pairing Rule.** Chinese terms lead with primary visual prominence, followed by secondary English parentheticals.

## Layout

The layout is built mobile-first, centered in a max-width container (768px max-width on mobile, expanding up to 1024px on desktop views). The spatial model uses an 8px base grid (4px, 8px, 12px, 16px, 24px) with dense vertical padding to maximize visible information per screen fold.

A persistent bottom navigation bar (56px height) provides 4 primary tabs on mobile:
1. Daily Sheet (记账)
2. Overview (概览)
3. Expenses (支出)
4. Close (结账)

## Elevation & Depth

Surfaces rely primarily on tonal layering and crisp 1px structural borders (#e2e8f0) rather than heavy drop shadows.

### Shadow Vocabulary
- **Ambient Card** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05)`): Subtle separation between cards and the canvas.
- **Elevated Bar** (`box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.05)`): Fixed bottom navigation bar separation from scrolling content.
- **Dropdown / Popover** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1)`): Floating calendars and selection menus.

### Named Rules
**The Hairline Discipline Rule.** Depth and separation are achieved through crisp 1px border lines and tonal fills (#f8fafc vs #ffffff) rather than blurred drop shadows.

## Shapes

- **Base Radius:** 8px (`rounded-md` or `rounded-lg`) for buttons, cards, and input fields.
- **Container Radius:** 12px - 16px (`rounded-xl` / `rounded-2xl`) for primary view containers and modal dialogs.
- **Pill Badges:** 9999px (`rounded-full`) for status tags and category chips.

## Components

### Buttons
- **Shape:** 8px - 12px radius, 48px minimum tap target.
- **Primary:** Forest green (#15803d) fill with bold white text, subtle hover darkening, and tactile ripple effect (`.btn-wave`).
- **Secondary:** White card background with #e2e8f0 border and #334155 text.

### Cards / Containers
- **Corner Style:** 12px - 16px radius.
- **Background:** White (#ffffff) atop #f8fafc canvas.
- **Border:** 1px hairline (#e2e8f0).
- **Padding:** 16px - 20px internal padding.

### Inputs & Number Fields
- **Style:** 10px - 12px radius, 44px - 48px height, white background, #cbd5e1 border.
- **Focus:** 2px focus ring tinted with primary green (#15803d).
- **Format:** Currency fields include fixed RM prefix and support clear keypad interactions.

### Navigation
- Top app header with 🥦 mascot logo, page title, and operator role pill.
- Bottom tab bar with 4 tabs and tactile tap targets.

## Do's and Don'ts

### Do:
- **Do** maintain a minimum 48px tap target on all interactive controls.
- **Do** format all currency as Malaysian Ringgit (MYR) with two decimal places (`RM XX.XX`).
- **Do** prioritize instant scanability for high-stress food stall environments.
- **Do** provide bilingual Chinese + English labels across all workflow screens.

### Don't:
- **Don't** use dark mode or low-contrast muted gray backgrounds.
- **Don't** use nested cards inside cards.
- **Don't** use heavy drop shadows, decorative glows, or SaaS gradient text.
- **Don't** block month close on reconciliation discrepancy—warn and record reason instead.
