export { metadata, viewport } from "./layout";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

// Static build: no build-time "today" (the Worker answers it per request).
export default function CloudLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh">
      <body className="bg-surface-canvas text-ink-primary antialiased selection:bg-brand-broccoli-light selection:text-brand-broccoli-dark">
        <I18nProvider>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
