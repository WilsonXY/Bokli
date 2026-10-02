import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guards the theme colour variables in app/globals.css: light must stay the
// original palette exactly, dark text pairs must meet WCAG AA (4.5:1).
const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

function readVars(selector: string): Record<string, [number, number, number]> {
  const block = css.match(new RegExp(`\\n  ${selector.replace(".", "\\.")} \\{([^}]*)\\}`));
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  const vars: Record<string, [number, number, number]> = {};
  for (const [, name, r, g, b] of block[1].matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+);/g)) {
    vars[name] = [Number(r), Number(g), Number(b)];
  }
  return vars;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = readVars(":root");
const dark = readVars(".dark");

describe("light theme variables", () => {
  // The pre-theming hex values (tailwind.config.ts tokens, plus the raw
  // Tailwind palette classes that were swapped for new tokens).
  const ORIGINAL: Record<string, string> = {
    surface: "#ffffff",
    "surface-canvas": "#f8fafc",
    "surface-subtle": "#f1f5f9",
    "surface-border": "#e2e8f0",
    "surface-border-strong": "#cbd5e1",
    "ink-primary": "#0f172a",
    "ink-secondary": "#334155",
    "ink-muted": "#64748b",
    "ink-faint": "#94a3b8", // slate-400
    "ink-on-accent": "#ffffff", // white
    "brand-broccoli": "#15803d",
    "brand-broccoli-light": "#dcfce7",
    "brand-broccoli-dark": "#166534",
    "brand-broccoli-subtle": "#ecfdf5", // emerald-50
    "brand-broccoli-soft": "#34d399", // emerald-400
    "channel-cash": "#059669",
    "channel-cash-light": "#ecfdf5",
    "channel-tng": "#2563eb",
    "channel-tng-light": "#eff6ff",
    "finance-cost": "#d97706",
    "finance-cost-light": "#fffbeb",
    "finance-profit": "#16a34a",
    "finance-profit-light": "#f0fdf4",
    "finance-profit-border": "#bbf7d0",
    "finance-profit-text": "#047857", // emerald-700
    "finance-loss": "#dc2626",
    "finance-loss-light": "#fef2f2",
    "finance-loss-border": "#fecaca",
    "finance-loss-text": "#e11d48", // rose-600
    "status-closed": "#166534",
    "status-closed-bg": "#dcfce7",
    "status-reopened": "#854d0e",
    "status-reopened-bg": "#fef9c3",
    "status-open": "#075985",
    "status-open-bg": "#e0f2fe",
    "chart-line": "#2563eb",
    "chart-line-strong": "#1d4ed8",
    "chart-halo": "#bfdbfe",
    "category-restock": "#2563eb",
    "category-gas": "#f59e0b",
    "category-transport": "#9333ea",
    "category-wages-daily": "#f43f5e",
    "category-maintenance": "#0d9488",
    "category-other": "#64748b",
  };

  it("matches the original palette exactly, token for token", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(ORIGINAL).sort());
    for (const [name, hex] of Object.entries(ORIGINAL)) {
      expect(light[name], name).toEqual(hexToRgb(hex));
    }
  });

  it("is overridden for every token by the dark theme", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

describe("dark theme contrast (WCAG AA, 4.5:1)", () => {
  const TEXT_ON_BACKGROUNDS = [
    "ink-primary",
    "ink-secondary",
    "ink-muted",
    "brand-broccoli",
    "channel-cash",
    "channel-tng",
    "finance-cost",
    "finance-loss",
    "finance-profit-text",
    "finance-loss-text",
    "status-closed",
    "status-reopened",
    "status-open",
  ];

  it.each(TEXT_ON_BACKGROUNDS)("%s text on surface and canvas", (text) => {
    expect(contrast(dark[text], dark.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark[text], dark["surface-canvas"])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["finance-loss", "finance-loss-light"],
    ["brand-broccoli", "brand-broccoli-light"],
    ["status-closed", "status-closed-bg"],
    ["status-reopened", "status-reopened-bg"],
    ["status-open", "status-open-bg"],
  ])("%s text on its %s tint", (text, bg) => {
    expect(contrast(dark[text], dark[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["brand-broccoli", "brand-broccoli-dark", "finance-loss", "status-closed", "channel-cash", "channel-tng"])(
    "on-accent text on a filled %s button",
    (fill) => {
      expect(contrast(dark["ink-on-accent"], dark[fill])).toBeGreaterThanOrEqual(4.5);
    }
  );
});
