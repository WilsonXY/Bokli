"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";

interface CloudPageProps<P> {
  /** The one query parameter the page reads (?date= or ?month=). */
  param: "date" | "month";
  load: (query: string) => Promise<P>;
  render: (props: P, reload: () => void) => React.ReactNode;
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

function Loader<P>({ param, load, render }: CloudPageProps<P>) {
  const { t } = useI18n();
  const value = useSearchParams().get(param);
  const query = value ? `?${param}=${encodeURIComponent(value)}` : "";
  const [state, setState] = useState<{ query: string; props?: P; stale?: boolean } | null>(null);
  const latest = useRef(0);

  // A reload keeps the current screen (and its drafts) until the new data lands.
  const reload = useCallback(() => {
    const call = ++latest.current;
    load(query).then(
      (props) => call === latest.current && setState({ query, props }),
      (err) => {
        console.error("Failed to load page data:", err);
        if (call === latest.current) setState((prev) => (prev?.query === query && prev.props ? { ...prev, stale: true } : { query }));
      },
    );
  }, [load, query]);
  useEffect(reload, [reload]);

  if (state?.query !== query) return <Skeleton />;
  const error = (
    <div role="alert" className="mb-3 p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss text-sm font-semibold">
      {t.loadError}
    </div>
  );
  if (!state.props) return error;
  // A failed refresh keeps the screen (and drafts) but says it may be out of date.
  return <>{state.stale && error}{render(state.props, reload)}</>;
}

/** Static cloud page: reads /api/cloud-v1/* in the browser, then renders the usual view. */
export function CloudPage<P>(props: CloudPageProps<P>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Loader {...props} />
    </Suspense>
  );
}
