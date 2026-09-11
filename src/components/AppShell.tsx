"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { signOut } from "next-auth/react";
import { useI18n } from "@/lib/i18n";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: string;
  todayKl?: string;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();
  const [showConfirmSignOut, setShowConfirmSignOut] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  // Tactile wave / ripple effect on all .btn-wave interactive elements
  React.useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const target = (e.target as HTMLElement)?.closest(".btn-wave") as HTMLElement | null;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      const ripple = document.createElement("span");
      ripple.className = "ripple-wave";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      target.appendChild(ripple);
      setTimeout(() => {
        ripple.remove();
      }, 600);
    }

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  // Close sign out modal on Escape key
  React.useEffect(() => {
    if (!showConfirmSignOut) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSigningOut) {
        setShowConfirmSignOut(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showConfirmSignOut, isSigningOut]);

  // Don't render chrome on standalone login page
  if (pathname === "/login") {
    return <div className="min-h-screen bg-surface-canvas">{children}</div>;
  }

  const navItems = [
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
        {/* Top Header - Ultra-Clean: Brand on Left, Language Toggle & Sign Out on Right */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-surface-border px-3.5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-h-[38px] select-none">
            <span className="text-2xl leading-none select-none flex items-center" role="img" aria-label="broccoli">
              🥦
            </span>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-extrabold text-lg text-ink-primary tracking-tight">
                Bokli
              </span>
              {lang === "zh" && (
                <span className="text-sm font-bold text-brand-broccoli tracking-wide">
                  簿里
                </span>
              )}
            </div>
          </div>

          {/* Right Controls: Accessible Language Toggle & Sign Out Button */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-surface-subtle border border-surface-border rounded-lg p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setLang("zh")}
                aria-label="切换到中文 (Switch to Chinese)"
                className={`min-h-[36px] min-w-[44px] px-3 py-1 rounded-md btn-wave transition-all flex items-center justify-center ${
                  lang === "zh"
                    ? "bg-white text-brand-broccoli shadow-xs font-bold"
                    : "text-ink-muted hover:text-ink-primary font-medium"
                }`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                aria-label="Switch to English"
                className={`min-h-[36px] min-w-[44px] px-3 py-1 rounded-md btn-wave transition-all flex items-center justify-center ${
                  lang === "en"
                    ? "bg-white text-brand-broccoli shadow-xs font-bold"
                    : "text-ink-muted hover:text-ink-primary font-medium"
                }`}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmSignOut(true)}
              title={t.signOut}
              aria-label={t.signOut}
              className="min-h-[44px] min-w-[44px] px-2 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-ink-muted hover:text-ink-primary flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
              </svg>
            </button>
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
                  className={`flex-1 flex flex-col items-center justify-center h-full active:scale-90 transition-all duration-150 ${
                    isActive
                      ? "text-brand-broccoli font-semibold"
                      : "text-ink-muted hover:text-ink-primary font-normal"
                  }`}
                >
                  <div className={`relative transition-transform duration-200 ${isActive ? "scale-110 -translate-y-0.5" : "scale-100"}`}>
                    {item.icon}
                  </div>
                  <span className="text-xs tracking-tight mt-0.5">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Sign Out Confirmation Popout Modal */}
      {showConfirmSignOut && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-signout-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSigningOut) {
              setShowConfirmSignOut(false);
            }
          }}
        >
          <div className="w-full max-w-xs sm:max-w-sm bg-white rounded-2xl p-5 sm:p-6 shadow-xl border border-surface-border space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-finance-loss-light border border-finance-loss-border/60 text-finance-loss flex items-center justify-center shrink-0 select-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
                </svg>
              </div>
              <h3 id="confirm-signout-title" className="text-base font-bold text-ink-primary">
                {t.confirmSignOutTitle}
              </h3>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={isSigningOut}
                onClick={() => setShowConfirmSignOut(false)}
                className="flex-1 min-h-[44px] h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={isSigningOut}
                onClick={async () => {
                  setIsSigningOut(true);
                  await signOut({ callbackUrl: "/login" });
                }}
                className="flex-1 min-h-[44px] h-11 rounded-xl bg-finance-loss hover:bg-finance-loss/90 active:bg-finance-loss-dark btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 disabled:opacity-50"
              >
                {isSigningOut ? (
                  <span>{t.signingOut}</span>
                ) : (
                  <span>{t.confirmSignOutBtn}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
