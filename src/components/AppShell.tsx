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
  const { t, lang } = useI18n();
  const [destinations, setDestinations] = React.useState<Record<string, string>>({});
  const items = [
    { href: "/", label: t.navSheet, path: "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3M8 2h8v4H8zM7 11h10M7 16h6" },
    { href: "/dashboard", label: t.navDashboard, path: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
    { href: "/expenses", label: t.navExpenses, path: "M3 7h18v13H3zM7 7V4h10v3M3 12h18M10 12v3h4v-3" },
    { href: "/close", label: t.navClose, path: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3" },
    { href: "/settings", label: t.navSettings, path: "M4 7h16M4 17h16M9 4v6M15 14v6" },
  ];
  const active = items.find(item => item.href === pathname) ?? items[0];
  return (
    <div className="app-workspace">
      <a href="#main-content" className="skip-link">{t.skipToContent}</a>
      <aside className="workspace-sidebar">
        <Link href="/" className="brand-lockup" aria-label={t.homeLabel}>
          <span className="brand-mark" aria-hidden="true">b<span /></span>
          <span className="brand-name">Bokli <span>簿里</span><small>{t.brandSubtitle}</small></span>
        </Link>
        <p className="sidebar-caption">{t.workspaceLabel}</p>
        <nav aria-label={t.mainNavigation} className="workspace-nav" onClickCapture={() => setDestinations(previous => ({ ...previous, [pathname]: window.location.pathname + window.location.search }))}>
          {items.map(item => <Link key={item.href} href={destinations[item.href] ?? item.href} aria-label={item.label} aria-current={pathname === item.href ? "page" : undefined} className="workspace-nav-link">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={item.path} /></svg>
            <span><span className={item.href === "/expenses" ? "desktop-nav-label" : undefined}>{item.label}</span>{item.href === "/expenses" && <span className="mobile-nav-label">{t.navExpensesShort}</span>}</span>
            {pathname === item.href && <span className="nav-active-dot" aria-hidden="true" />}
          </Link>)}
        </nav>
        <div className="sidebar-footer"><span className="currency-mark">RM</span><div>{t.currencyLabel}<small>{t.klTime}</small></div></div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <Link href="/" className="mobile-brand" aria-label={t.homeLabel}>Bokli <span>簿里</span></Link>
          <div className="workspace-breadcrumb"><span>{t.brandSubtitle}</span><span aria-hidden="true">/</span><span>{active.label}</span></div>
          <span className="header-currency"><span className="currency-indicator" aria-hidden="true" /><span className="desktop-currency">{lang === "zh" ? "马来西亚令吉 · MYR" : "Malaysian Ringgit · MYR"}</span><span className="mobile-subtitle">{t.brandSubtitle}</span></span>
        </header>
        <main id="main-content" tabIndex={-1} className={`workspace-main ${pathname === "/dashboard" ? "workspace-main-wide" : ""}`}>{children}</main>
        <footer className="workspace-footer"><span>Bokli · {t.brandSubtitle}</span><span>{t.klTime} · MYR</span></footer>
      </div>
    </div>
  );
}
