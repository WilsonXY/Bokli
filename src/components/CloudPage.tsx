"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";

interface CloudPageProps<P> {
  /** The one query parameter the page reads (?date= or ?month=). */
  param: "date" | "month";
  load: (query: string) => Promise<P>;
  /** `quiet`: the view reports a failure itself, so keep the page-level alert off. */
  render: (props: P, reload: (opts?: { quiet?: boolean }) => Promise<boolean>) => React.ReactNode;
  /** Shown while loading; shape it like the loaded page so nothing jumps. */
  skeleton?: React.ReactNode;
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-10 rounded-xl bg-surface-subtle animate-pulse" />
      <div className="h-24 rounded-2xl bg-surface-subtle animate-pulse" />
      <div className="h-24 rounded-2xl bg-surface-subtle animate-pulse" />
    </div>
  );
}

function Loader<P>({ param, load, render, skeleton = <Skeleton /> }: CloudPageProps<P>) {
  const { t } = useI18n();
  const value = useSearchParams().get(param);
  const query = value ? `?${param}=${encodeURIComponent(value)}` : "";
  const [state, setState] = useState<{ query: string; props?: P; stale?: boolean } | null>(null);
  const latest = useRef(0);

  // A reload keeps the current screen (and its drafts) until the new data lands.
  const reload = useCallback((opts?: { quiet?: boolean }): Promise<boolean> => {
    const call = ++latest.current;
    return load(query).then(
      (props) => {
        if (call === latest.current) setState({ query, props });
        return call === latest.current;
      },
      (err) => {
        console.error("Failed to load page data:", err);
        if (call === latest.current) {
          setState((prev) =>
            prev?.query === query && prev.props ? { ...prev, stale: !opts?.quiet } : { query },
          );
        }
        return false;
      },
    );
  }, [load, query]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Changing the date or month swaps the whole view (skeleton, then a fresh
  // view), which would drop keyboard focus on <body>. Remember the last
  // focused period control ([data-period-control]) and put focus back on the
  // same control in the new view, or on the period trigger if it is now
  // disabled (Next Day on today).
  const lastPeriodControl = useRef<string | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-period-control]") : null;
      lastPeriodControl.current = el?.dataset.periodControl ?? null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const landedQuery = state?.props ? state.query : null;
  useEffect(() => {
    const key = lastPeriodControl.current;
    if (landedQuery !== query || !key) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const pick = (k: string) =>
        document.querySelector<HTMLElement>(`[data-period-control="${k}"]:not(:disabled)`);
      (pick(key) ?? pick("trigger"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [landedQuery, query]);

  if (state?.query !== query) return skeleton;
  const error = (
    <div role="alert" className="mb-3 p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss text-sm font-semibold flex items-center justify-between gap-3">
      <span>{t.loadError}</span>
      <button
        type="button"
        onClick={() => void reload()}
        className="shrink-0 min-h-[44px] px-4 rounded-xl border border-finance-loss-border bg-surface hover:bg-surface-subtle text-finance-loss font-semibold text-xs btn-tactile cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60"
      >
        {t.retry}
      </button>
    </div>
  );
  if (!state.props) return error;
  // A failed refresh keeps the screen (and drafts) but says it may be out of date.
  return <>{state.stale && error}{render(state.props, reload)}</>;
}

/** Static cloud page: reads /api/cloud-v1/* in the browser, then renders the usual view. */
export function CloudPage<P>(props: CloudPageProps<P>) {
  return (
    <Suspense fallback={props.skeleton ?? <Skeleton />}>
      <Loader {...props} />
    </Suspense>
  );
}
