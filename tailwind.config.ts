import type { Config } from "tailwindcss";

// Colours are RGB channel triplets in CSS variables (light values on :root,
// dark values on .dark — see app/globals.css) so opacity modifiers still work.
const themed = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          broccoli: themed("brand-broccoli"),
          "broccoli-light": themed("brand-broccoli-light"),
          "broccoli-dark": themed("brand-broccoli-dark"),
          "broccoli-subtle": themed("brand-broccoli-subtle"),
          "broccoli-soft": themed("brand-broccoli-soft"),
        },
        surface: {
          DEFAULT: themed("surface"),
          canvas: themed("surface-canvas"),
          subtle: themed("surface-subtle"),
          border: themed("surface-border"),
          "border-strong": themed("surface-border-strong"),
        },
        ink: {
          primary: themed("ink-primary"),
          secondary: themed("ink-secondary"),
          muted: themed("ink-muted"),
          faint: themed("ink-faint"),
          "on-accent": themed("ink-on-accent"),
        },
        channel: {
          cash: themed("channel-cash"),
          "cash-light": themed("channel-cash-light"),
          tng: themed("channel-tng"),
          "tng-light": themed("channel-tng-light"),
        },
        finance: {
          cost: themed("finance-cost"),
          "cost-light": themed("finance-cost-light"),
          profit: themed("finance-profit"),
          "profit-light": themed("finance-profit-light"),
          "profit-border": themed("finance-profit-border"),
          "profit-text": themed("finance-profit-text"),
          loss: themed("finance-loss"),
          "loss-light": themed("finance-loss-light"),
          "loss-border": themed("finance-loss-border"),
          "loss-text": themed("finance-loss-text"),
        },
        status: {
          closed: themed("status-closed"),
          "closed-bg": themed("status-closed-bg"),
          reopened: themed("status-reopened"),
          "reopened-bg": themed("status-reopened-bg"),
          open: themed("status-open"),
          "open-bg": themed("status-open-bg"),
        },
        chart: {
          line: themed("chart-line"),
          "line-strong": themed("chart-line-strong"),
          halo: themed("chart-halo"),
        },
        category: {
          restock: themed("category-restock"),
          gas: themed("category-gas"),
          transport: themed("category-transport"),
          "wages-daily": themed("category-wages-daily"),
          maintenance: themed("category-maintenance"),
          other: themed("category-other"),
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      minHeight: {
        tap: "48px",
      },
      minWidth: {
        tap: "48px",
      },
    },
  },
  plugins: [],
};

export default config;
