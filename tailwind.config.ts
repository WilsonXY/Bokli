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
          broccoli: "#15803d",
          "broccoli-light": "#dcfce7",
          "broccoli-dark": "#166534",
        },
        surface: {
          DEFAULT: "#ffffff",
          canvas: "#f8fafc",
          subtle: "#f1f5f9",
          border: "#e2e8f0",
          "border-strong": "#cbd5e1",
        },
        ink: {
          primary: "#0f172a",
          secondary: "#334155",
          muted: "#64748b",
        },
        channel: {
          cash: "#059669",
          "cash-light": "#ecfdf5",
          tng: "#2563eb",
          "tng-light": "#eff6ff",
        },
        finance: {
          cost: "#d97706",
          "cost-light": "#fffbeb",
          profit: "#16a34a",
          "profit-light": "#f0fdf4",
          "profit-border": "#bbf7d0",
          loss: "#dc2626",
          "loss-light": "#fef2f2",
          "loss-border": "#fecaca",
        },
        status: {
          closed: "#166534",
          "closed-bg": "#dcfce7",
          reopened: "#854d0e",
          "reopened-bg": "#fef9c3",
          open: "#075985",
          "open-bg": "#e0f2fe",
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
