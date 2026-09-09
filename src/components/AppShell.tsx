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
  const { t, lang, setLang } = useI18n();

  // Don't render chrome on standalone login page
  if (pathname === "/login") {
    return <div className="min-h-screen bg-surface-canvas">{children}</div>;
  }

  const navItems = [
    {
      href: "/",
      label: t.navSheet,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard",
      label: t.navDashboard,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      href: "/expenses",
      label: t.navExpenses,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      ),
    },
    {
      href: "/close",
      label: t.navClose,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary flex flex-col items-center">
      <div className="w-full max-w-xl min-h-screen bg-surface-canvas flex flex-col relative sm:border-x sm:border-surface-border">
        {/* Top Header - Ultra-Clean: Brand on Left, Language Toggle on Right */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-surface-border px-3.5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none select-none" role="img" aria-label="broccoli">
              🥦
            </span>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-bold text-sm text-ink-primary tracking-tight">
                Bokli
              </span>
              {lang === "zh" && (
                <span className="text-xs font-semibold text-brand-broccoli">
                  簿里
                </span>
              )}
            </div>
          </div>

          {/* Right Controls: Clean Language Toggle Only */}
          <div className="flex items-center">
            <div className="flex items-center bg-surface-subtle border border-surface-border rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLang("zh")}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  lang === "zh"
                    ? "bg-white text-brand-broccoli shadow-xs font-semibold"
                    : "text-ink-muted hover:text-ink-primary"
                }`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  lang === "en"
                    ? "bg-white text-brand-broccoli shadow-xs font-semibold"
                    : "text-ink-muted hover:text-ink-primary"
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Viewport with Normal Spacing */}
        <main className="flex-1 px-3.5 py-4 pb-24">{children}</main>

        {/* Persistent Bottom Navigation - Normalized Height & Clean SVG Icons */}
        <nav
          aria-label="Bottom Navigation"
          className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-surface-border"
        >
          <div className="max-w-xl mx-auto flex items-center justify-around h-14 px-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center justify-center h-full transition-colors ${
                    isActive
                      ? "text-brand-broccoli font-semibold"
                      : "text-ink-muted hover:text-ink-primary font-normal"
                  }`}
                >
                  <div className="relative">{item.icon}</div>
                  <span className="text-xs tracking-tight mt-0.5">
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
