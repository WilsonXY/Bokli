"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const RETRY_DEADLINE_MS = 10_000;

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
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  // A retry belongs to the period it was started for and gives up after
  // RETRY_DEADLINE_MS; a stale or abandoned attempt never touches the UI.
  const retryAttempt = useRef(0);
  useEffect(() => {
    retryAttempt.current += 1;
    setRetrying(false);
    setRetryFailed(false);
  }, [query]);

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
      if (!(e.target instanceof Element)) return;
      // The load-error Retry keeps the period control as the return target.
      if (e.target.closest("[data-period-retry]")) return;
      const el = e.target.closest<HTMLElement>("[data-period-control]");
      lastPeriodControl.current = el?.dataset.periodControl ?? null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const landedQuery = state?.props ? state.query : null;
  // A period that failed to load replaces the view with the error: give its
  // Retry the focus that fell to <body>.
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const failedQuery = state && !state.props ? state.query : null;
  useEffect(() => {
    if (failedQuery === null || failedQuery !== query) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) retryRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [failedQuery, query]);
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
    <div role="alert" className="mb-3 p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss text-sm font-semibold flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span>
        {t.loadError}
        {retryFailed && <span className="block mt-0.5 font-medium">{t.loadStillFailing}</span>}
      </span>
      <button
        ref={retryRef}
        type="button"
        data-period-retry
        aria-disabled={retrying}
        aria-busy={retrying}
        onClick={() => {
          // One request at a time; the button stays mounted and focused.
          if (retrying) return;
          const attempt = ++retryAttempt.current;
          setRetrying(true);
          const deadline = setTimeout(() => {
            if (attempt !== retryAttempt.current) return;
            retryAttempt.current += 1;
            setRetrying(false);
            setRetryFailed(true);
          }, RETRY_DEADLINE_MS);
          void reload().then((ok) => {
            clearTimeout(deadline);
            if (attempt !== retryAttempt.current) return;
            setRetrying(false);
            setRetryFailed(!ok);
            if (!ok) return;
            // The focused Retry is gone once the page recovers: land on the
            // remembered period control, else the period trigger.
            requestAnimationFrame(() => {
              const active = document.activeElement;
              if (active && active !== document.body) return;
              const pick = (k: string | null) =>
                k ? document.querySelector<HTMLElement>(`[data-period-control="${k}"]:not(:disabled)`) : null;
              (pick(lastPeriodControl.current) ?? pick("trigger"))?.focus();
            });
          });
        }}
        className="shrink-0 min-h-[44px] w-full sm:w-auto sm:min-w-[8.5rem] px-4 rounded-xl border border-finance-loss-border bg-surface hover:bg-surface-subtle text-finance-loss font-semibold text-sm btn-tactile inline-flex items-center justify-center gap-1.5 cursor-pointer aria-disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60"
      >
        {retrying && (
          <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {retrying ? t.refreshingStatus : t.retry}
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
