"use client";

import React, { Suspense, createContext, useCallback, useContext, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export interface LeaveNavigationRequest {
  href: string;
  historyDelta?: number;
  triggerEl: HTMLElement | null;
}

interface UnsavedGuardEntry {
  isDirty: (targetHref?: string) => boolean;
  onRequestLeave: (request: LeaveNavigationRequest) => void;
}

interface UnsavedGuardContextValue {
  registerGuard: (entry: UnsavedGuardEntry) => () => void;
  confirmNavigation: (href: string, triggerEl?: HTMLElement | null) => boolean;
  proceedHistoryNavigation: (delta: number) => void;
}

const UnsavedGuardContext = createContext<UnsavedGuardContextValue>({
  registerGuard: () => () => {},
  confirmNavigation: () => true,
  proceedHistoryNavigation: () => {},
});

function HistoryIndexTracker({ onRouteSync }: { onRouteSync: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    onRouteSync();
  }, [pathname, search, onRouteSync]);

  return null;
}

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const guardRef = useRef<UnsavedGuardEntry | null>(null);
  const currentIdxRef = useRef<number>(-1);
  const suppressPopstateRef = useRef<number>(0);
  const allowNextPopstateRef = useRef<boolean>(false);

  const onRouteSync = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = window.history.state;
    const existing =
      state && typeof state === "object" && typeof state.__bokliIdx === "number"
        ? (state.__bokliIdx as number)
        : null;
    if (existing !== null) {
      currentIdxRef.current = existing;
      return;
    }
    const nextIdx = currentIdxRef.current + 1;
    currentIdxRef.current = nextIdx;
    try {
      const nextState =
        state && typeof state === "object"
          ? { ...state, __bokliIdx: nextIdx }
          : { __bokliIdx: nextIdx };
      History.prototype.replaceState.call(window.history, nextState, "");
    } catch {
      // Ignore restricted history environments
    }
  }, []);

  // Intercept browser Back / Forward (popstate) in capture phase before Next.js App Router unmounts dirty forms
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (e: PopStateEvent) => {
      if (suppressPopstateRef.current > 0) {
        suppressPopstateRef.current -= 1;
        e.stopImmediatePropagation();
        return;
      }
      if (allowNextPopstateRef.current) {
        allowNextPopstateRef.current = false;
        return;
      }

      const active = guardRef.current;
      const targetHref =
        window.location.pathname + window.location.search + window.location.hash;
      if (!active || !active.isDirty(targetHref)) {
        return;
      }

      e.stopImmediatePropagation();

      const destState = e.state;
      const destIdx =
        destState && typeof destState === "object" && typeof destState.__bokliIdx === "number"
          ? (destState.__bokliIdx as number)
          : null;
      const currentIdx = currentIdxRef.current;
      const delta =
        destIdx !== null && currentIdx >= 0 && destIdx !== currentIdx
          ? destIdx - currentIdx
          : -1;

      suppressPopstateRef.current += 1;
      window.history.go(-delta);

      active.onRequestLeave({
        href: targetHref,
        historyDelta: delta,
        triggerEl:
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
      });
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  const registerGuard = useCallback((entry: UnsavedGuardEntry) => {
    guardRef.current = entry;
    return () => {
      if (guardRef.current === entry) {
        guardRef.current = null;
      }
    };
  }, []);

  const confirmNavigation = useCallback(
    (href: string, triggerEl: HTMLElement | null = null) => {
      const active = guardRef.current;
      if (active && active.isDirty(href)) {
        active.onRequestLeave({ href, triggerEl });
        return false;
      }
      return true;
    },
    []
  );

  const proceedHistoryNavigation = useCallback((delta: number) => {
    if (typeof window === "undefined") return;
    allowNextPopstateRef.current = true;
    window.history.go(delta);
  }, []);

  return (
    <UnsavedGuardContext.Provider
      value={{ registerGuard, confirmNavigation, proceedHistoryNavigation }}
    >
      <Suspense fallback={null}>
        <HistoryIndexTracker onRouteSync={onRouteSync} />
      </Suspense>
      {children}
    </UnsavedGuardContext.Provider>
  );
}

export function useUnsavedGuard() {
  return useContext(UnsavedGuardContext);
}
