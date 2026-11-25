import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { UnsavedGuardProvider } from "@/lib/unsaved-guard";
import "./globals.css";

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bokli 簿里 — 家庭摊位记账",
  description: "Bookkeeping for the family food stall: daily sheets, operating expenses, and month close",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f6f2",
};

// Restore saved Dark Mode synchronously before paint; Bright Mode is always default.
const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("bokli_theme")==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}}catch(e){}})();`;

// Static build: no build-time "today" (the Worker answers it per request).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hans" className={notoSansSc.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans font-medium bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <ThemeProvider>
          <I18nProvider>
            <UnsavedGuardProvider>
              <AppShell>{children}</AppShell>
            </UnsavedGuardProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
