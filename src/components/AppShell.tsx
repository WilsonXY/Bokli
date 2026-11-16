"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
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
    { href: "/", label: t.navSheet, short: t.navSheetShort, path: "M12 5v14M5 12h14" },
    { href: "/dashboard", label: t.navDashboard, short: t.navDashboard, path: "M4 20V10m8 10V4m8 16v-7" },
    { href: "/expenses", label: t.navExpenses, short: t.navExpensesShort, path: "M4 5h16v15H4zM8 5V3m8 2V3M8 10h8M8 15h5" },
    { href: "/close", label: t.navClose, short: t.navClose, path: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3" },
    { href: "/settings", label: t.navSettings, short: t.navSettings, path: "M4 7h16M4 17h16M9 4v6M15 14v6" },
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
