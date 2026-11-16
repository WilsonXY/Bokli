import type { Metadata, Viewport } from "next";
import { AppearanceProvider } from "@/components/AppearanceProvider";
import { DraftProvider } from "@/components/DraftProvider";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n";
import "../public/fonts/noto-sans-sc.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bokli 簿里 — 家庭摊位记账",
  description: "Bookkeeping for the family food stall: daily sheets, expenses, and month close",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f7f5",
};

// Static build: no build-time "today" (the Worker answers it per request).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hans" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: 'try{if(localStorage.getItem("bokli_theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}' }} />
      </head>
      <body className="bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <AppearanceProvider>
          <I18nProvider>
            <DraftProvider><AppShell>{children}</AppShell></DraftProvider>
          </I18nProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
