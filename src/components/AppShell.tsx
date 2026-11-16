"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { monthCloseIconPath } from "./ActionIcon";
import { useI18n } from "@/lib/i18n";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: string;
  todayKl?: string;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [destinations, setDestinations] = React.useState<Record<string, string>>({});
  const items = [
    { href: "/", label: t.navSheet, short: t.navSheetShort, path: "M14 3H4v18h16V11M8 16l1-4 9-9 3 3-9 9-4 1Z" },
    { href: "/dashboard", label: t.navDashboard, short: t.navDashboard, path: "M4 20V10m8 10V4m8 16v-7" },
    { href: "/expenses", label: t.navExpenses, short: t.navExpensesShort, path: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8M8 15h4" },
    { href: "/close", label: t.navClose, short: t.navClose, path: monthCloseIconPath },
    { href: "/settings", label: t.navSettings, short: t.navSettings, path: "M10 2h4v3l3 1.7 2.6-1.5 2 3.5-2.6 1.5v3.6l2.6 1.5-2 3.5-2.6-1.5-3 1.7v3h-4v-3l-3-1.7-2.6 1.5-2-3.5L5 13.8v-3.6L2.4 8.7l2-3.5L7 6.7 10 5V2ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0" },
  ];
  function navigation(mobile: boolean) {
    return <nav aria-label={t.mainNavigation} className={mobile ? "mobile-navigation" : "desktop-navigation"} onClickCapture={() => {
      const search = window.location.search;
      setDestinations(previous => ({ ...previous, [pathname]: window.location.pathname + search, ...(pathname === "/close" ? { "/dashboard": "/dashboard" + search } : {}) }));
    }}>
      {items.filter(item => !mobile || item.href !== "/close").map(item => {
        const selected = pathname === item.href || (mobile && pathname === "/close" && item.href === "/dashboard");
        return <Link key={item.href} href={destinations[item.href] ?? item.href} aria-label={item.label} title={item.label} aria-current={selected ? "page" : undefined} className={`workspace-nav-link ${item.href === "/" ? "nav-record" : ""}`}>
          <span className="nav-icon"><svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={item.path} /></svg></span>
          <span className="nav-label">{mobile ? item.short : item.label}</span>
        </Link>;
      })}
    </nav>;
  }
  return <div className="app-workspace">
    <a href="#main-content" className="skip-link">{t.skipToContent}</a>
    <aside className="workspace-sidebar">
      <Link href="/" className="brand-lockup" aria-label={t.homeLabel}><span className="brand-mark" aria-hidden="true">b<span /></span><span className="brand-name">Bokli<small>簿里</small></span></Link>
      {navigation(false)}
      {navigation(true)}
    </aside>
    <div className="workspace-body">
      <header className="workspace-header">
        <Link href="/" className="mobile-brand" aria-label={t.homeLabel}><span className="mobile-brand-mark" aria-hidden="true">b<span /></span><span>Bokli <small>簿里</small></span></Link>
      </header>
      <main id="main-content" tabIndex={-1} className={`workspace-main ${pathname === "/dashboard" ? "workspace-main-wide" : ""}`} data-page={pathname}>{children}</main>
    </div>
  </div>;
}
