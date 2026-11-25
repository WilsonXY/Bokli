import type { Config } from "tailwindcss";

const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

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
          broccoli: withAlpha("--brand-broccoli"),
          "broccoli-light": withAlpha("--brand-broccoli-light"),
          "broccoli-dark": withAlpha("--brand-broccoli-dark"),
          cta: withAlpha("--brand-cta"),
          "cta-hover": withAlpha("--brand-cta-hover"),
          "cta-ink": withAlpha("--brand-cta-ink"),
        },
        danger: {
          cta: withAlpha("--danger-cta"),
          "cta-hover": withAlpha("--danger-cta-hover"),
          "cta-ink": withAlpha("--danger-cta-ink"),
        },
        surface: {
          DEFAULT: withAlpha("--surface-default"),
          canvas: withAlpha("--surface-canvas"),
          subtle: withAlpha("--surface-subtle"),
          hover: withAlpha("--surface-hover"),
          border: withAlpha("--surface-border"),
          "border-strong": withAlpha("--surface-border-strong"),
          input: withAlpha("--surface-input"),
        },
        ink: {
          primary: withAlpha("--ink-primary"),
          secondary: withAlpha("--ink-secondary"),
          muted: withAlpha("--ink-muted"),
        },
        channel: {
          cash: withAlpha("--channel-cash"),
          "cash-light": withAlpha("--channel-cash-light"),
          tng: withAlpha("--channel-tng"),
          "tng-light": withAlpha("--channel-tng-light"),
        },
        finance: {
          cost: withAlpha("--finance-cost"),
          "cost-light": withAlpha("--finance-cost-light"),
          opex: withAlpha("--finance-opex"),
          "opex-light": withAlpha("--finance-opex-light"),
          profit: withAlpha("--finance-profit"),
          "profit-light": withAlpha("--finance-profit-light"),
          "profit-border": withAlpha("--finance-profit-border"),
          loss: withAlpha("--finance-loss"),
          "loss-light": withAlpha("--finance-loss-light"),
          "loss-border": withAlpha("--finance-loss-border"),
        },
        status: {
          closed: withAlpha("--status-closed"),
          "closed-bg": withAlpha("--status-closed-bg"),
          reopened: withAlpha("--status-reopened"),
          "reopened-bg": withAlpha("--status-reopened-bg"),
          open: withAlpha("--status-open"),
          "open-bg": withAlpha("--status-open-bg"),
        },
      },
      fontFamily: {
        sans: [
          "var(--font-noto-sans-sc)",
          "'Noto Sans SC'",
          "'PingFang SC'",
          "'Microsoft YaHei'",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
      },
      minHeight: {
        tap: "48px",
      },
      minWidth: {
        tap: "48px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22, 22, 20, 0.04)",
        popover: "0 12px 32px -6px rgba(22, 22, 20, 0.16), 0 4px 10px -4px rgba(22, 22, 20, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
