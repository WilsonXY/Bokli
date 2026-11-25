import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readStoredTheme, THEME_STORAGE_KEY } from "./theme";

describe("readStoredTheme", () => {
  it("defaults to bright mode ('light') when storage is empty or missing", () => {
    expect(readStoredTheme({ getItem: () => null })).toBe("light");
    expect(readStoredTheme({ getItem: () => "" })).toBe("light");
    expect(readStoredTheme({ getItem: () => "system" })).toBe("light");
  });

  it("returns 'dark' only when dark mode is explicitly saved", () => {
    const store = new Map<string, string>([[THEME_STORAGE_KEY, "dark"]]);
    expect(readStoredTheme({ getItem: (k) => store.get(k) ?? null })).toBe("dark");
  });

  it("falls back to 'light' if storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("storage blocked");
      },
    };
    expect(readStoredTheme(broken)).toBe("light");
  });
});

function parseRgb(value: string): [number, number, number] {
  const clean = value.trim();
  if (clean.startsWith("#") && clean.length === 7) {
    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16),
    ];
  }
  const parts = clean.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  throw new Error(`Unsupported color token value: ${value}`);
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function extractBlockTokens(css: string, selector: string): Record<string, [number, number, number]> {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`Missing CSS block ${selector}`);
  const start = css.indexOf("{", idx);
  const end = css.indexOf("}", start);
  const body = css.slice(start + 1, end);
  const tokens: Record<string, [number, number, number]> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, name, raw] = match;
    const stripped = raw.replace(/\/\*.*?\*\//g, "").trim();
    if (/^#[0-9a-f]{6}$/i.test(stripped) || /^\d+\s+\d+\s+\d+$/.test(stripped)) {
      tokens[name] = parseRgb(stripped);
    }
  }
  return tokens;
}

describe("semantic color token separation", () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
  const financeTokens = [
    "--channel-cash",
    "--channel-tng",
    "--finance-cost",
    "--finance-opex",
    "--finance-profit",
    "--finance-loss",
  ];
  const categoryTokens = [
    "--cat-restock",
    "--cat-gas",
    "--cat-transport",
    "--cat-wages",
    "--cat-maintenance",
    "--cat-other",
    "--op-rental",
    "--op-utilities",
    "--op-wages",
    "--op-other",
  ];

  for (const [label, selector] of [
    ["Light Mode (:root)", ":root {"],
    ["Dark Mode (.dark)", ".dark {"],
  ] as const) {
    it(`keeps every Cost & Operating Expense category visually distinct from channels/finance in ${label}`, () => {
      const tokens = extractBlockTokens(css, selector);
      expect(tokens["--finance-opex"]).toBeDefined();
      for (const fin of financeTokens) {
        expect(tokens[fin], `Missing ${fin}`).toBeDefined();
        for (const cat of categoryTokens) {
          expect(tokens[cat], `Missing ${cat}`).toBeDefined();
          const dist = rgbDistance(tokens[fin], tokens[cat]);
          expect(
            dist,
            `${label}: ${cat} is too close to ${fin} (distance ${dist.toFixed(1)} < 68)`
          ).toBeGreaterThanOrEqual(68);
        }
      }
    });
  }
});
