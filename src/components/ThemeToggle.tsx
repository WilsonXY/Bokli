"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme";

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const ICON_PATHS: Record<ThemePreference, string> = {
  light:
    "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z",
  dark:
    "M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z",
  system:
    "M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25",
};

// Cycles light → dark → system. The stored choice is read after mount (the
// server cannot see localStorage); THEME_INIT_SCRIPT has already applied it
// before first paint, so nothing is re-applied until the choice is known.
export function ThemeToggle() {
  const { t } = useI18n();
  const [preference, setPreference] = React.useState<ThemePreference | null>(null);

  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage blocked: fall back to following the system.
    }
    setPreference(parseThemePreference(stored));
  }, []);

  React.useEffect(() => {
    if (preference === null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(resolveTheme(preference, media.matches), document.documentElement);
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const current = preference ?? "system";
  const labels: Record<ThemePreference, string> = {
    light: t.themeLight,
    dark: t.themeDark,
    system: t.themeSystem,
  };

  function handleClick() {
    const next = NEXT_PREFERENCE[current];
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    setPreference(next);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${t.themeToggle}: ${labels[current]}`}
      aria-label={`${t.themeToggle}: ${labels[current]}`}
      className="min-h-[44px] min-w-[44px] px-2 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-ink-muted hover:text-ink-primary flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[current]} />
      </svg>
    </button>
  );
}
