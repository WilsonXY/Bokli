"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const AppearanceContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({ theme: "light", setTheme: () => {} });

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bokli_theme");
      updateTheme(saved === "dark" ? "dark" : "light");
    } catch { /* Preferences still work when storage is blocked. */ }
  }, []);
  function setTheme(next: Theme) {
    updateTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("bokli_theme", next); } catch { /* In-memory preference remains usable. */ }
  }
  return <AppearanceContext.Provider value={{ theme, setTheme }}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);
