export type ThemePreference = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export function parseThemePreference(stored: unknown): ThemePreference {
  return stored === "light" || stored === "dark" ? stored : "system";
}

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function nextThemePreference(current: ThemePreference): ThemePreference {
  return NEXT_PREFERENCE[current];
}

export function resolveTheme(stored: unknown, systemPrefersDark: boolean): Theme {
  const preference = parseThemePreference(stored);
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}

export const THEME_STORAGE_KEY = "bokli-theme";

// Browser chrome (<meta name="theme-color">) cannot read CSS variables; these
// mirror --surface-canvas for each theme in app/globals.css.
export const THEME_CANVAS_COLOR: Record<Theme, string> = {
  light: "#f8fafc",
  dark: "#0f172a",
};

// Inline <head> script: applies the stored theme before first paint so dark
// mode never flashes white. Self-contained on purpose (it runs before any
// bundle loads); it must agree with resolveTheme — theme.test.ts checks that.
export const THEME_INIT_SCRIPT = `(function () {
  var stored = null;
  try { stored = localStorage.getItem("${THEME_STORAGE_KEY}"); } catch (e) {}
  var dark = stored === "dark" ||
    (stored !== "light" && !!window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark"); else root.classList.remove("dark");
  root.style.colorScheme = dark ? "dark" : "light";
})();`;

interface ThemeRoot {
  classList: { toggle(token: string, force: boolean): unknown };
  style: { colorScheme: string };
}

export function applyTheme(theme: Theme, root: ThemeRoot): void {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
