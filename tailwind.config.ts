import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          broccoli: "rgb(var(--brand) / <alpha-value>)",
          "broccoli-light": "rgb(var(--brand-light) / <alpha-value>)",
          "broccoli-dark": "rgb(var(--brand-dark) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          canvas: "rgb(var(--canvas) / <alpha-value>)",
          subtle: "rgb(var(--subtle) / <alpha-value>)",
          border: "rgb(var(--border) / <alpha-value>)",
          "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        },
        ink: {
          primary: "rgb(var(--ink) / <alpha-value>)",
          secondary: "rgb(var(--secondary) / <alpha-value>)",
          muted: "rgb(var(--muted) / <alpha-value>)",
        },
        channel: {
          cash: "rgb(var(--cash) / <alpha-value>)",
          "cash-light": "rgb(var(--cash-light) / <alpha-value>)",
          tng: "rgb(var(--tng) / <alpha-value>)",
          "tng-light": "rgb(var(--tng-light) / <alpha-value>)",
        },
        finance: {
          cost: "rgb(var(--cost) / <alpha-value>)",
          "cost-light": "rgb(var(--cost-light) / <alpha-value>)",
          profit: "rgb(var(--profit) / <alpha-value>)",
          "profit-light": "rgb(var(--profit-light) / <alpha-value>)",
          "profit-border": "rgb(var(--profit-border) / <alpha-value>)",
          loss: "rgb(var(--loss) / <alpha-value>)",
          "loss-light": "rgb(var(--loss-light) / <alpha-value>)",
          "loss-border": "rgb(var(--loss-border) / <alpha-value>)",
        },
        status: {
          closed: "rgb(var(--brand-dark) / <alpha-value>)",
          "closed-bg": "rgb(var(--brand-light) / <alpha-value>)",
          reopened: "rgb(var(--reopened) / <alpha-value>)",
          "reopened-bg": "rgb(var(--reopened-bg) / <alpha-value>)",
          open: "rgb(var(--open) / <alpha-value>)",
          "open-bg": "rgb(var(--open-bg) / <alpha-value>)",
        },
      },
      backgroundColor: { white: "rgb(var(--surface) / <alpha-value>)" },
      fontWeight: { normal: "500", medium: "500", semibold: "500", bold: "500", extrabold: "500", black: "500" },
      fontFamily: { sans: ['"Noto Sans SC"', "sans-serif"] },
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
