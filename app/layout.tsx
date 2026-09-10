import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bokli 🥦 — 家庭摊位记账",
  description: "Bookkeeping for the family food stall: daily sheets, expenses, and month close",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const todayKl = getTodayInKualaLumpur();

  return (
    <html lang="zh">
      <body className="bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <I18nProvider>
          <AppShell todayKl={todayKl}>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
