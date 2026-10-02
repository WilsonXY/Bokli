import { describe, it, expect } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  nextThemePreference,
  parseThemePreference,
  resolveTheme,
} from "./theme";

describe("resolveTheme", () => {
  it("returns the stored theme when it is light or dark, regardless of the system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("resolveTheme with no explicit choice", () => {
  it("follows the system preference when the stored value is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("treats a missing or unrecognised stored value as system", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(undefined, false)).toBe("light");
    expect(resolveTheme("purple", true)).toBe("dark");
  });
});

describe("parseThemePreference", () => {
  it("keeps light, dark and system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for a missing or unrecognised stored value", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("Dark")).toBe("system");
  });
});

describe("THEME_INIT_SCRIPT (runs before first paint)", () => {
  function runScript(
    stored: string | null,
    systemPrefersDark: boolean,
    storageThrows = false,
    hasMatchMedia = true
  ) {
    const classes = new Set<string>();
    const root = {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      style: { colorScheme: "" },
    };
    const localStorage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("storage blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const matchMedia = (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemPrefersDark,
    });
    new Function("window", "document", "localStorage", "matchMedia", THEME_INIT_SCRIPT)(
      hasMatchMedia ? { matchMedia } : {},
      { documentElement: root },
      localStorage,
      hasMatchMedia ? matchMedia : undefined
    );
    return { isDark: classes.has("dark"), colorScheme: root.style.colorScheme };
  }

  it("applies the same theme as resolveTheme for every stored value and system preference", () => {
    for (const stored of ["light", "dark", "system", null, "", "junk"]) {
      for (const systemPrefersDark of [true, false]) {
        const expected = resolveTheme(stored, systemPrefersDark);
        const result = runScript(stored, systemPrefersDark);
        expect(result.isDark).toBe(expected === "dark");
        expect(result.colorScheme).toBe(expected);
      }
    }
  });

  it("reads the bokli-theme localStorage key", () => {
    expect(THEME_STORAGE_KEY).toBe("bokli-theme");
  });

  it("falls back to light without throwing when matchMedia is unavailable", () => {
    expect(runScript(null, true, false, false)).toEqual({ isDark: false, colorScheme: "light" });
    expect(runScript("dark", true, false, false)).toEqual({ isDark: true, colorScheme: "dark" });
  });

  it("follows the system preference when localStorage is unavailable", () => {
    expect(runScript(null, true, true)).toEqual({ isDark: true, colorScheme: "dark" });
    expect(runScript(null, false, true)).toEqual({ isDark: false, colorScheme: "light" });
  });
});

describe("applyTheme", () => {
  function fakeRoot(initialDark: boolean) {
    const classes = new Set<string>(initialDark ? ["dark"] : []);
    return {
      classes,
      classList: { toggle: (c: string, force: boolean) => (force ? classes.add(c) : classes.delete(c)) },
      style: { colorScheme: "" },
    };
  }

  it("adds the dark class and dark color-scheme for the dark theme", () => {
    const root = fakeRoot(false);
    applyTheme("dark", root);
    expect(root.classes.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("removes the dark class and sets light color-scheme for the light theme", () => {
    const root = fakeRoot(true);
    applyTheme("light", root);
    expect(root.classes.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });
});

describe("nextThemePreference", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(nextThemePreference("system")).toBe("light");
  });
});
