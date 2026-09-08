import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bokli 🥦 — 家庭摊位记账",
  description: "Bookkeeping for the family food stall: daily sheets, expenses, and month close",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const todayKl = getTodayInKualaLumpur();

  return (
    <html lang="zh">
      <body className="bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <AppShell todayKl={todayKl}>{children}</AppShell>
      </body>
    </html>
  );
}
