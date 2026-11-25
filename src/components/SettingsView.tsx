"use client";

import React, { useEffect, useState } from "react";
import { useI18n, type Language } from "@/lib/i18n";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { cloudIdentity } from "@/lib/cloud-client";
import type { UserRole } from "@/db/schema";

interface SettingsViewProps {
  initialRole?: UserRole | null;
}

export function SettingsView({ initialRole = null }: SettingsViewProps) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const [role, setRole] = useState<UserRole | null>(initialRole);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  useEffect(() => {
    if (initialRole) return;
    let active = true;
    cloudIdentity()
      .then((identity) => {
        if (active) setRole(identity.role);
      })
      .catch(() => {
        // Non-blocking: role badge is optional on settings screen
      });
    return () => {
      active = false;
    };
  }, [initialRole]);

  useEffect(() => {
    if (!showSignOutModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSignOutModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSignOutModal]);

  const themeOptions: Array<{
    value: ThemeMode;
    label: string;
    desc: string;
    ariaLabel: string;
    previewBg: string;
    previewCard: string;
    previewBorder: string;
    previewLine: string;
    previewInk: string;
    icon: React.ReactNode;
  }> = [
    {
      value: "light",
      label: t.themeLight,
      desc: t.themeLightDesc,
      ariaLabel: "Switch to Bright Mode",
      previewBg: "#f7f6f2",
      previewCard: "#ffffff",
      previewBorder: "#d7d4ca",
      previewLine: "#15803d",
      previewInk: "#161614",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ),
    },
    {
      value: "dark",
      label: t.themeDark,
      desc: t.themeDarkDesc,
      ariaLabel: "Switch to Dark Mode",
      previewBg: "#11110f",
      previewCard: "#1a1a18",
      previewBorder: "#3a3934",
      previewLine: "#4ade80",
      previewInk: "#f3f2ee",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      ),
    },
  ];

  const languageOptions: Array<{
    value: Language;
    label: string;
    desc: string;
    badge: string;
    ariaLabel: string;
  }> = [
    {
      value: "zh",
      label: t.langZh,
      desc: t.langZhDesc,
      badge: "中文",
      ariaLabel: "切换到中文 (Switch to Chinese)",
    },
    {
      value: "en",
      label: t.langEn,
      desc: t.langEnDesc,
      badge: "EN",
      ariaLabel: "Switch to English",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink-primary tracking-tight">
          {t.settingsTitle}
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          {t.settingsSubtitle}
        </p>
      </div>

      {/* Balanced 12-col Desktop Grid (equal workspace edges matching Dashboard/Expenses/Close) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 7 Cols: Appearance & Language Preferences */}
        <div className="lg:col-span-7 space-y-5">
          {/* Appearance Section */}
          <fieldset className="bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-4">
            <div>
              <legend className="text-base font-bold text-ink-primary">
                {t.appearanceTitle}
              </legend>
              <p className="text-[13px] text-ink-muted mt-0.5">
                {t.appearanceDesc}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {themeOptions.map((opt) => {
                const active = theme === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`group relative text-left p-4 rounded-xl border btn-tactile flex flex-col gap-3.5 min-h-[48px] cursor-pointer focus-within:ring-2 focus-within:ring-brand-broccoli ${
                      active
                        ? "border-brand-broccoli bg-brand-broccoli-light/65 ring-1 ring-brand-broccoli/25"
                        : "border-surface-border bg-surface hover:border-surface-border-strong hover:bg-surface-subtle/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bokli-theme"
                      value={opt.value}
                      checked={active}
                      onChange={() => setTheme(opt.value)}
                      aria-label={opt.ariaLabel}
                      className="sr-only"
                    />

                    {/* Mini Theme Swatch Preview */}
                    <div
                      className="w-full h-16 rounded-lg border p-2.5 flex flex-col justify-between overflow-hidden"
                      style={{
                        backgroundColor: opt.previewBg,
                        borderColor: opt.previewBorder,
                      }}
                      aria-hidden="true"
                    >
                      <div className="flex items-center justify-between">
                        <span className="h-2 w-12 rounded-full" style={{ backgroundColor: opt.previewLine }} />
                        <span className="h-2 w-6 rounded-full opacity-30" style={{ backgroundColor: opt.previewInk }} />
                      </div>
                      <div
                        className="h-7 rounded-md border px-2 flex items-center justify-between"
                        style={{
                          backgroundColor: opt.previewCard,
                          borderColor: opt.previewBorder,
                        }}
                      >
                        <span className="h-1.5 w-10 rounded-full opacity-35" style={{ backgroundColor: opt.previewInk }} />
                        <span className="h-2 w-8 rounded-full" style={{ backgroundColor: opt.previewLine }} />
                      </div>
                    </div>

                    {/* Label & Active Check */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className={`mt-0.5 shrink-0 ${active ? "text-brand-broccoli" : "text-ink-muted"}`}>
                          {opt.icon}
                        </span>
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold ${active ? "text-brand-broccoli" : "text-ink-primary"}`}>
                            {opt.label}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5 leading-snug">
                            {opt.desc}
                          </div>
                        </div>
                      </div>
                      <span
                        aria-hidden="true"
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          active
                            ? "bg-brand-cta border-brand-cta text-brand-cta-ink"
                            : "border-surface-border-strong bg-surface"
                        }`}
                      >
                        {active && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Language Section */}
          <fieldset className="bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-4">
            <div>
              <legend className="text-base font-bold text-ink-primary">
                {t.languageTitle}
              </legend>
              <p className="text-[13px] text-ink-muted mt-0.5">
                {t.languageDesc}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {languageOptions.map((opt) => {
                const active = lang === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`relative text-left px-4 py-3.5 rounded-xl border btn-tactile flex items-center justify-between gap-3 min-h-[56px] cursor-pointer focus-within:ring-2 focus-within:ring-brand-broccoli ${
                      active
                        ? "border-brand-broccoli bg-brand-broccoli-light/65 ring-1 ring-brand-broccoli/25"
                        : "border-surface-border bg-surface hover:border-surface-border-strong hover:bg-surface-subtle/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bokli-language"
                      value={opt.value}
                      checked={active}
                      onChange={() => setLang(opt.value)}
                      aria-label={opt.ariaLabel}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-10 h-10 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 border ${
                          active
                            ? "bg-brand-cta text-brand-cta-ink border-brand-cta"
                            : "bg-surface-subtle text-ink-secondary border-surface-border"
                        }`}
                      >
                        {opt.badge}
                      </span>
                      <div className="min-w-0">
                        <div className={`text-sm font-semibold ${active ? "text-brand-broccoli" : "text-ink-primary"}`}>
                          {opt.label}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {opt.desc}
                        </div>
                      </div>
                    </div>

                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        active
                          ? "bg-brand-cta border-brand-cta text-brand-cta-ink"
                          : "border-surface-border-strong bg-surface"
                      }`}
                    >
                      {active && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        {/* Right 5 Cols: Account & Ledger Context */}
        <div className="lg:col-span-5 space-y-5">
          {/* Account & Sign Out Section */}
          <section
            aria-labelledby="settings-account-heading"
            className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden divide-y divide-surface-border"
          >
            <div className="px-5 py-4 sm:px-6">
              <h2 id="settings-account-heading" className="text-base font-bold text-ink-primary">
                {t.accountTitle}
              </h2>
            </div>

            {role && (
              <div className="px-5 py-4 sm:px-6 flex items-center justify-between gap-3">
                <span className="text-sm text-ink-secondary">{t.accountRoleLabel}</span>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-brand-broccoli-light text-brand-broccoli border border-brand-broccoli/20">
                  {role === "Admin" ? t.roleAdmin : t.roleOperator}
                </span>
              </div>
            )}

            <div className="p-5 sm:px-6 space-y-3.5">
              <div>
                <div className="text-sm font-semibold text-ink-primary">
                  {t.signOut}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t.signOutDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSignOutModal(true)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-surface-border-strong bg-surface hover:bg-surface-subtle text-ink-primary font-semibold text-sm btn-tactile flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                <svg className="w-4 h-4 text-ink-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
                </svg>
                <span>{t.signOut}</span>
              </button>
            </div>
          </section>

          {/* Ledger Details Reference Card */}
          <section
            aria-labelledby="settings-ledger-heading"
            className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden divide-y divide-surface-border"
          >
            <div className="px-5 py-4 sm:px-6">
              <h2 id="settings-ledger-heading" className="text-base font-bold text-ink-primary">
                {t.ledgerInfoTitle}
              </h2>
            </div>
            <dl className="divide-y divide-surface-border text-sm">
              <div className="px-5 py-3.5 sm:px-6 flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t.ledgerCurrencyLabel}</dt>
                <dd className="font-semibold text-ink-primary num-tabular">MYR (RM)</dd>
              </div>
              <div className="px-5 py-3.5 sm:px-6 flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t.ledgerTimezoneLabel}</dt>
                <dd className="font-semibold text-ink-primary">{t.klTime}</dd>
              </div>
              <div className="px-5 py-3.5 sm:px-6 flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t.reconciliationChannelsLabel}</dt>
                <dd className="font-semibold text-ink-primary">{t.reconciliationChannelsValue}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {/* Sign Out Confirmation Modal */}
      {showSignOutModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-signout-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSignOutModal(false);
          }}
        >
          <div className="w-full max-w-xs sm:max-w-sm bg-surface rounded-2xl p-6 shadow-popover border border-surface-border space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-surface-subtle border border-surface-border text-ink-secondary flex items-center justify-center shrink-0 select-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 id="settings-signout-title" className="text-base font-bold text-ink-primary">
                  {t.confirmSignOutTitle}
                </h3>
                <p className="text-[13px] text-ink-muted mt-0.5">
                  {t.signOutDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowSignOutModal(false)}
                className="flex-1 min-h-[48px] rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => window.location.assign("/cdn-cgi/access/logout")}
                className="flex-1 min-h-[48px] rounded-xl bg-ink-primary hover:opacity-90 btn-tactile text-surface font-semibold text-sm flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                <span>{t.confirmSignOutBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
