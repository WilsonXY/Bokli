"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Drafts live only in this open app, never on disk or in the database. The
// layout survives route changes, so preferences cannot discard entered data.
const DraftContext = createContext<Map<string, unknown> | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, unknown>());
  useEffect(() => {
    function protectUnsaved(event: BeforeUnloadEvent) {
      if (drafts.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [drafts]);
  return <DraftContext.Provider value={drafts}>{children}</DraftContext.Provider>;
}

export function useDraftCache<T>(key: string) {
  const drafts = useContext(DraftContext);
  const restored = useMemo(() => drafts?.get(key) as T | undefined, [drafts, key]);
  const remember = useCallback((next: T | null | ((current: T | undefined) => T | null)) => {
    const draft = typeof next === "function" ? (next as (current: T | undefined) => T | null)(drafts?.get(key) as T | undefined) : next;
    if (draft === null) drafts?.delete(key);
    else drafts?.set(key, draft);
  }, [drafts, key]);
  return [restored, remember] as const;
}

export function useUnsavedDrafts() {
  const drafts = useContext(DraftContext);
  return { hasDrafts: Boolean(drafts?.size), discardAll: () => drafts?.clear() };
}
