"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: string;
  todayKl?: string;
}

const NAV_ITEMS = [
  {
    href: "/",
    zh: "记账",
    en: "Daily Sheet",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
    zh: "概览",
    en: "Dashboard",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
    zh: "支出",
    en: "Expenses",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
    zh: "结账",
    en: "Month Close",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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

export function AppShell({ children, userRole = "Operator", todayKl }: AppShellProps) {
  const pathname = usePathname();

  // Don't render chrome on standalone login page
  if (pathname === "/login") {
    return <div className="min-h-screen bg-surface-canvas">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary flex flex-col items-center">
      <div className="w-full max-w-[768px] min-h-screen bg-surface-canvas flex flex-col relative border-x border-surface-border shadow-sm">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-surface-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none select-none" role="img" aria-label="broccoli">
              🥦
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg text-ink-primary tracking-tight">
                  Bokli
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand-broccoli-light font-bold text-brand-broccoli">
                  簿里
                </span>
              </div>
              <p className="text-[11px] text-ink-muted leading-none mt-0.5">
                家庭摊位记账 · Food Stall Ops
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {todayKl && (
              <span className="hidden sm:inline-flex text-xs px-2 py-1 bg-surface-subtle border border-surface-border rounded-md font-mono text-ink-secondary">
                {todayKl}
              </span>
            )}
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-surface-subtle border-surface-border text-ink-secondary">
              {userRole}
            </span>
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main className="flex-1 px-4 py-5 pb-28">{children}</main>

        {/* Persistent Bottom Navigation */}
        <nav
          aria-label="Bottom Navigation"
          className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-surface-border"
        >
          <div className="max-w-[768px] mx-auto flex items-center justify-around h-16 px-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center justify-center h-full min-h-tap transition-all ${
                    isActive
                      ? "text-brand-broccoli font-bold border-t-2 border-brand-broccoli bg-brand-broccoli-light/20 -mt-[1px]"
                      : "text-ink-muted hover:text-ink-secondary font-medium"
                  }`}
                >
                  <div className="relative">{item.icon}</div>
                  <span className="text-[11px] tracking-tight mt-0.5">
                    {item.zh}{" "}
                    <span className="hidden xs:inline text-[9px] opacity-75">
                      {item.en}
                    </span>
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
