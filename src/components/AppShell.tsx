"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cloudIdentity } from "@/lib/cloud-client";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { BokliMark } from "@/components/BokliIcons";
import type { UserRole } from "@/db/schema";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: string;
  todayKl?: string;
}

export function AppShell({ children, userRole }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { confirmNavigation } = useUnsavedGuard();
  const lastNonSettingsHrefRef = useRef<string | null>(null);
  const [resolvedRole, setResolvedRole] = useState<UserRole | null>(
    userRole === "Admin" || userRole === "Operator" ? userRole : null,
  );

  // Remember the last non-Settings page so clicking the Settings button again closes Settings and returns there
  useEffect(() => {
    if (pathname.startsWith("/settings")) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const href = `${pathname}${search}`;
    lastNonSettingsHrefRef.current = href;
    try {
      sessionStorage.setItem("bokli_prev_route", href);
    } catch {
      // Ignore storage failures
    }
  }, [pathname]);

  const handleSettingsToggleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (pathname.startsWith("/settings")) {
      e.preventDefault();
      let returnHref = lastNonSettingsHrefRef.current;
      if (!returnHref || returnHref.startsWith("/settings")) {
        try {
          const saved = sessionStorage.getItem("bokli_prev_route");
          if (saved && saved.startsWith("/") && !saved.startsWith("/settings")) {
            returnHref = saved;
          }
        } catch {
          // Ignore storage failures
        }
      }
      router.push(returnHref && !returnHref.startsWith("/settings") ? returnHref : "/");
      return;
    }
    // Capture the exact current URL (including ?date= or ?month= query changes on the same pathname) right before leaving
    const currentSearch = typeof window !== "undefined" ? window.location.search : "";
    const currentHref = `${pathname}${currentSearch}`;
    lastNonSettingsHrefRef.current = currentHref;
    try {
      sessionStorage.setItem("bokli_prev_route", currentHref);
    } catch {
      // Ignore storage failures
    }
    handleNavClick(e, "/settings");
  };

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    // Tapping the already-active tab without a query string to clear is a true no-op
    const currentSearch = typeof window !== "undefined" ? window.location.search : "";
    if (href === pathname && currentSearch === "") {
      e.preventDefault();
      return;
    }
    if (!confirmNavigation(href, e.currentTarget)) {
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (resolvedRole) return;
    let active = true;
    cloudIdentity()
      .then((identity) => {
        if (active) setResolvedRole(identity.role);
      })
      .catch(() => {
        // Non-blocking: sidebar identity pill is optional on SSR / unauthenticated views
      });
    return () => {
      active = false;
    };
  }, [resolvedRole]);

  const primaryNav = [
    {
      href: "/dashboard",
      label: t.navDashboard,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      ),
    },
    {
      href: "/",
      label: t.navSheet,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
    },
    {
      href: "/expenses",
      label: t.navExpenses,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
      ),
    },
    {
      href: "/close",
      label: t.navClose,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  const settingsIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );

  function isNavActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  const roleLabel =
    resolvedRole === "Admin"
      ? t.roleAdmin
      : resolvedRole === "Operator"
        ? t.roleOperator
        : null;

  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar Navigation (Full-height architectural rail with sticky nav) */}
      <aside
        aria-label={t.navSidebarLabel}
        className="hidden lg:block lg:w-[244px] shrink-0 bg-surface border-r border-surface-border z-30"
      >
        <div className="sticky top-0 h-screen flex flex-col">
        {/* Brand Header */}
        <Link
          href="/dashboard"
          onClick={(e) => handleNavClick(e, "/dashboard")}
          className="px-5 pt-6 pb-5 flex items-center gap-3 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-broccoli"
        >
          <div className="w-10 h-10 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/20 text-brand-broccoli flex items-center justify-center shrink-0">
            <BokliMark className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 leading-tight">
              <span className="font-bold text-[17px] text-ink-primary tracking-tight">
                Bokli
              </span>
              {lang === "zh" && (
                <span className="text-[13px] font-semibold text-brand-broccoli">
                  簿里
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted truncate mt-0.5">
              {t.brandSubtitle}
            </p>
          </div>
        </Link>

        {/* Primary Nav Links */}
        <nav aria-label={t.navPrimaryLabel} className="flex-1 px-3 py-2 space-y-1">
          {primaryNav.map((item) => {
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => handleNavClick(e, item.href)}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 px-3.5 min-h-[44px] rounded-xl text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
                  active
                    ? "bg-brand-broccoli-light text-brand-broccoli font-semibold"
                    : "text-ink-secondary hover:bg-surface-subtle hover:text-ink-primary font-medium"
                }`}
              >
                <span className={active ? "text-brand-broccoli" : "text-ink-muted group-hover:text-ink-primary transition-colors"}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Identity & Settings Link (clicking again closes Settings) */}
        <div className="px-3 py-4 border-t border-surface-border">
          <Link
            href="/settings"
            onClick={handleSettingsToggleClick}
            aria-current={isNavActive("/settings") ? "page" : undefined}
            title={isNavActive("/settings") ? t.closeSettings : t.navSettings}
            className={`group flex items-center justify-between gap-2.5 px-3.5 py-2.5 min-h-[48px] rounded-xl text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
              isNavActive("/settings")
                ? "bg-brand-broccoli-light text-brand-broccoli font-semibold"
                : "text-ink-secondary hover:bg-surface-subtle hover:text-ink-primary font-medium"
            }`}
          >
            <span className="flex items-center gap-3 min-w-0">
              <span className={isNavActive("/settings") ? "text-brand-broccoli" : "text-ink-muted group-hover:text-ink-primary transition-colors"}>
                {settingsIcon}
              </span>
              <span className="truncate">{t.navSettings}</span>
            </span>
            {roleLabel && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-ink-muted border border-surface-border shrink-0">
                {roleLabel}
              </span>
            )}
          </Link>
        </div>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile & Tablet Top Header — Solid opaque surface so scrolled amounts never bleed through */}
        <header className="lg:hidden sticky top-0 z-30 bg-surface border-b border-surface-border shadow-[0_1px_4px_rgba(22,22,20,0.06)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.34)] px-4 h-14 flex items-center justify-between">
          <Link
            href="/dashboard"
            onClick={(e) => handleNavClick(e, "/dashboard")}
            className="flex items-center gap-2.5 min-h-[44px] select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli rounded-lg"
          >
            <span className="w-8 h-8 rounded-lg bg-brand-broccoli-light border border-brand-broccoli/20 text-brand-broccoli flex items-center justify-center shrink-0">
              <BokliMark className="w-5 h-5" />
            </span>
            <div className="flex items-baseline gap-1.5 leading-none">
              <span className="font-bold text-[17px] text-ink-primary tracking-tight">
                Bokli
              </span>
              {lang === "zh" && (
                <span className="text-[13px] font-semibold text-brand-broccoli">
                  簿里
                </span>
              )}
            </div>
          </Link>

          <Link
            href="/settings"
            onClick={handleSettingsToggleClick}
            aria-label={isNavActive("/settings") ? t.closeSettings : t.navSettings}
            aria-current={isNavActive("/settings") ? "page" : undefined}
            title={isNavActive("/settings") ? t.closeSettings : t.navSettings}
            className={`min-h-[48px] min-w-[48px] rounded-xl flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
              isNavActive("/settings")
                ? "bg-brand-broccoli-light text-brand-broccoli"
                : "text-ink-muted hover:bg-surface-subtle hover:text-ink-primary"
            }`}
          >
            {settingsIcon}
          </Link>
        </header>

        {/* Responsive Main Workspace */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-5 lg:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-12">
          {children}
        </main>

        {/* Mobile & Tablet Persistent Bottom Navigation (4 spacious primary tabs) */}
        <nav
          data-bottom-nav="true"
          aria-label={t.navBottomLabel}
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-surface-border shadow-[0_-2px_10px_rgba(22,22,20,0.06)] dark:shadow-[0_-4px_14px_rgba(0,0,0,0.36)] pb-[env(safe-area-inset-bottom)] overflow-hidden"
        >
          <div className="max-w-xl mx-auto grid grid-cols-4 h-16 px-1">
            {primaryNav.map((item) => {
              const active = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] px-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-broccoli ${
                    active
                      ? "text-brand-broccoli font-semibold"
                      : "text-ink-muted hover:text-ink-primary font-medium"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute top-[1px] left-1/2 -translate-x-1/2 w-8 h-[2.5px] rounded-full bg-brand-broccoli"
                    />
                  )}
                  <span className="transition-transform duration-150">
                    {item.icon}
                  </span>
                  <span className="text-[12px] leading-none tracking-tight whitespace-nowrap">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
