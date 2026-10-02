import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n";
import { getTodayInKualaLumpur } from "@/lib/datetime";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bokli 🥦 — 家庭摊位记账",
  description: "Bookkeeping for the family food stall: daily sheets, expenses, and month close",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Browser chrome colour cannot read CSS variables; these mirror
  // --surface-canvas (light / dark) in app/globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const todayKl = getTodayInKualaLumpur();

  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <I18nProvider>
          <AppShell todayKl={todayKl}>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
