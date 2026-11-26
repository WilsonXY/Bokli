"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sanitizeMoneyInput, tryParseSen } from "@/lib/money";
import { apiFetch, READ_DEADLINE_MS } from "@/lib/cloud-client";
import { useI18n, translateApiError, apiErrorPayloadFrom, type TranslationMap } from "@/lib/i18n";
import { useModalFocusTrap } from "@/lib/use-modal-focus-trap";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";
import { MoneyValue } from "@/components/MoneyValue";
import { CashIcon, TngIcon } from "@/components/BokliIcons";

interface FinancialSnapshot {
  revenueSen: number;
  dailyCostSen: number;
  grossSen: number;
  operatingSen: number;
  netSen: number;
}

export interface CloseRecordData {
  isClosed: boolean;
  isReopened: boolean;
  closedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  cashOnHandSen?: number;
  tngOnHandSen?: number;
  expectedSen?: number;
  actualSen?: number;
  differenceSen?: number;
  balanced?: boolean;
  note?: string | null;
}

export interface MonthCloseViewProps {
  /**
   * Cloud build: re-fetch the page data; router.refresh() only re-renders a
   * static page. `quiet`: this view reports a failed refresh itself.
   */
  onRefresh?: (opts?: { quiet?: boolean }) => void | Promise<boolean | void>;
  currentMonth: string;
  availableMonths: string[];
  financials?: FinancialSnapshot | null;
  closeRecord?: CloseRecordData | null;
  userRole?: string;
  hasSheetsInMonth?: boolean;
  monthOptions?: MonthOption[];
  loadError?: string | null;
  initialCashOnHandInput?: string;
  initialTngOnHandInput?: string;
  initialCloseNote?: string;
  initialConfirmEmpty?: boolean;
  initialErrorMessage?: string | null;
}

export interface ReconciliationGatingResult {
  cashOnHandSen: bigint | null;
  tngOnHandSen: bigint | null;
  cashError: boolean;
  tngError: boolean;
  hasParseError: boolean;
  actualCountedSen: bigint | null;
  varianceSen: bigint | null;
  isBalanced: boolean;
  canClose: boolean;
  validationError: "invalidAmount" | "emptyMonthError" | "varianceNoteRequired" | null;
}

export function computeReconciliationGating(params: {
  cashInput: string;
  tngInput: string;
  expectedNetSen: bigint;
  closeNote: string;
  hasSheetsInMonth: boolean;
  confirmEmpty: boolean;
}): ReconciliationGatingResult {
  const cashOnHandSen = tryParseSen(params.cashInput);
  const tngOnHandSen = tryParseSen(params.tngInput);
  const cashError = params.cashInput.trim() !== "" && cashOnHandSen === null;
  const tngError = params.tngInput.trim() !== "" && tngOnHandSen === null;
  const hasParseError = cashError || tngError;

  const actualCountedSen =
    !hasParseError && cashOnHandSen !== null && tngOnHandSen !== null
      ? cashOnHandSen + tngOnHandSen
      : null;
  const varianceSen =
    actualCountedSen !== null ? actualCountedSen - params.expectedNetSen : null;
  const isBalanced = varianceSen !== null && varianceSen === 0n;

  let validationError: "invalidAmount" | "emptyMonthError" | "varianceNoteRequired" | null = null;
  if (hasParseError || cashOnHandSen === null || tngOnHandSen === null) {
    validationError = "invalidAmount";
  } else if (!params.hasSheetsInMonth && !params.confirmEmpty) {
    validationError = "emptyMonthError";
  } else if (!isBalanced && !params.closeNote.trim()) {
    validationError = "varianceNoteRequired";
  }

  return {
    cashOnHandSen,
    tngOnHandSen,
    cashError,
    tngError,
    hasParseError,
    actualCountedSen,
    varianceSen,
    isBalanced,
    canClose: validationError === null,
    validationError,
  };
}

export interface SubmitMonthCloseParams {
  submitting: boolean;
  gating: ReconciliationGatingResult;
  currentMonth: string;
  closeNote: string;
  confirmEmpty: boolean;
  t: TranslationMap;
  setErrorMessage: (message: string | null) => void;
  setSubmitting: (submitting: boolean) => void;
  setSuccessMessage: (message: string | null) => void;
  showSuccessMessage?: (message: string) => void;
  onClosed: () => void;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

// Month Close submission; the gating result is the single source for validation and parsed amounts.
export async function submitMonthClose({
  submitting,
  gating,
  currentMonth,
  closeNote,
  confirmEmpty,
  t,
  setErrorMessage,
  setSubmitting,
  setSuccessMessage,
  showSuccessMessage,
  onClosed,
  fetchImpl = apiFetch,
}: SubmitMonthCloseParams): Promise<void> {
  if (submitting) return;
  setErrorMessage(null);

  if (gating.validationError !== null) {
    setErrorMessage(t[gating.validationError]);
    return;
  }
  // Non-null: validationError is "invalidAmount" whenever either amount is null.
  const cashOnHandSen = gating.cashOnHandSen!;
  const tngOnHandSen = gating.tngOnHandSen!;

  setSubmitting(true);

  try {
    const res = await fetchImpl("/api/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: currentMonth,
        cashOnHandSen: Number(cashOnHandSen),
        tngOnHandSen: Number(tngOnHandSen),
        note: closeNote.trim() || undefined,
        confirmEmpty,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data.error ?? ""), { code: data.code });
    }

    if (showSuccessMessage) {
      showSuccessMessage(t.closeSuccess);
    } else {
      setSuccessMessage(t.closeSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);
    }
    onClosed();
  } catch (err) {
    setErrorMessage(translateApiError(apiErrorPayloadFrom(err), t));
  } finally {
    setSubmitting(false);
  }
}

export function MonthCloseView({
  onRefresh,
  currentMonth,
  availableMonths,
  financials,
  closeRecord,
  userRole,
  hasSheetsInMonth = false,
  monthOptions,
  loadError,
  initialCashOnHandInput = "",
  initialTngOnHandInput = "",
  initialCloseNote = "",
  initialConfirmEmpty = false,
  initialErrorMessage = null,
}: MonthCloseViewProps) {
  const router = useRouter();
  const refresh = onRefresh ?? (() => router.refresh());
  const { t, lang } = useI18n();

  const [cashOnHandInput, setCashOnHandInput] = useState(initialCashOnHandInput);
  const [tngOnHandInput, setTngOnHandInput] = useState(initialTngOnHandInput);
  const [closeNote, setCloseNote] = useState(initialCloseNote);
  const [confirmEmpty, setConfirmEmpty] = useState(initialConfirmEmpty);

  const [showReopenBox, setShowReopenBox] = useState(false);
  const [reopenReasonInput, setReopenReasonInput] = useState("");
  const [reopenReasonError, setReopenReasonError] = useState<string | null>(null);
  const reopenBtnRef = useRef<HTMLButtonElement | null>(null);
  const reopenReasonRef = useRef<HTMLInputElement | null>(null);
  const cashOnHandInputRef = useRef<HTMLInputElement | null>(null);
  const errorAlertRef = useRef<HTMLDivElement | null>(null);
  const staleRetryRef = useRef<HTMLButtonElement | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [pendingStatusTarget, setPendingStatusTarget] = useState<"closed" | "open" | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retryingRefresh, setRetryingRefresh] = useState(false);
  const [retryFailedOnce, setRetryFailedOnce] = useState(false);
  // Only the latest refresh attempt may update progress or failure; a timed
  // out or superseded attempt that settles later is ignored.
  const refreshAttemptRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{
    href: string;
    historyDelta?: number;
    returnFocusTo: HTMLElement | null;
    isMonthSwitch?: boolean;
  } | null>(null);
  const discardModalRef = useRef<HTMLDivElement | null>(null);
  const { registerGuard, proceedHistoryNavigation } = useUnsavedGuard();

  useEffect(() => {
    if (errorMessage) {
      errorAlertRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [errorMessage]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const expectedNetSen = financials ? BigInt(financials.netSen) : 0n;
  const gating = computeReconciliationGating({
    cashInput: cashOnHandInput,
    tngInput: tngOnHandInput,
    expectedNetSen,
    closeNote,
    hasSheetsInMonth,
    confirmEmpty,
  });

  const {
    cashError,
    tngError,
    hasParseError,
    actualCountedSen,
    varianceSen,
    isBalanced,
  } = gating;
  const hasCashInput = cashOnHandInput.trim() !== "";
  const hasTngInput = tngOnHandInput.trim() !== "";
  const hasInputs = hasCashInput || hasTngInput;
  const hasPartialInput = hasCashInput !== hasTngInput;
  const isAwaitingCount = !hasInputs && !hasParseError;
  const isTransitioning = submitting || pendingStatusTarget !== null;
  const canSubmitClose = !isTransitioning && !isAwaitingCount && gating.canClose;
  const closeReadinessHint = isAwaitingCount
    ? t.closeReadyAwaitingHint
    : !hasSheetsInMonth && !confirmEmpty
    ? t.emptyMonthError
    : null;

  const isClosed = Boolean(closeRecord?.isClosed);
  const isReopened = Boolean(closeRecord?.isReopened);

  // A submitted count waiting for the refreshed record is saved, not a draft.
  const isCloseDraftDirty =
    (!isClosed &&
      pendingStatusTarget !== "closed" &&
      (cashOnHandInput !== initialCashOnHandInput ||
        tngOnHandInput !== initialTngOnHandInput ||
        closeNote !== initialCloseNote ||
        confirmEmpty !== initialConfirmEmpty)) ||
    (isClosed && showReopenBox && reopenReasonInput.trim() !== "");

  const isCloseDraftDirtyRef = useRef(isCloseDraftDirty);
  // Only the write itself blocks leaving: once the server has acknowledged it,
  // a slow status refresh must not trap the user on this page.
  const submittingRef = useRef(submitting);
  const isClosedRef = useRef(isClosed);
  useEffect(() => {
    isCloseDraftDirtyRef.current = isCloseDraftDirty;
    submittingRef.current = submitting;
    isClosedRef.current = isClosed;
  }, [isCloseDraftDirty, submitting, isClosed]);

  // A write landed but the refresh failed: move focus to the inline Retry, but
  // only when focus was dropped or still sits in the action area; never pull
  // it out of the month picker or anything else the user moved on to.
  useEffect(() => {
    if (refreshFailed && pendingStatusTarget !== null) {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest("[data-close-action-area]")) {
          staleRetryRef.current?.focus();
        }
      });
    }
  }, [refreshFailed, pendingStatusTarget]);

  // The deadline runs until the expected status is on screen, not just until
  // a request resolves: a read that returns the old status still surfaces
  // Retry after READ_DEADLINE_MS.
  useEffect(() => {
    if (pendingStatusTarget === null || refreshFailed || submitting) return;
    const id = setTimeout(() => setRefreshFailed(true), READ_DEADLINE_MS);
    return () => clearTimeout(id);
  }, [pendingStatusTarget, refreshFailed, submitting]);
  useEffect(() => {
    if (!retryingRefresh) return;
    const id = setTimeout(() => {
      refreshAttemptRef.current += 1; // abandon the stalled attempt
      setRetryingRefresh(false);
      setRetryFailedOnce(true);
    }, READ_DEADLINE_MS);
    return () => clearTimeout(id);
  }, [retryingRefresh]);

  // Clear pending refresh lock once the refreshed status actually lands
  useEffect(() => {
    if (
      (pendingStatusTarget === "closed" && isClosed) ||
      (pendingStatusTarget === "open" && !isClosed)
    ) {
      if (pendingStatusTarget === "closed") {
        setCashOnHandInput(initialCashOnHandInput);
        setTngOnHandInput(initialTngOnHandInput);
        setCloseNote(initialCloseNote);
        setConfirmEmpty(initialConfirmEmpty);
      }
      setPendingStatusTarget(null);
      setRefreshFailed(false);
      setRetryFailedOnce(false);
      setRetryingRefresh(false);
      refreshAttemptRef.current += 1; // a retry still in flight is now moot
      // The form that held focus was replaced; land focus on the new state's
      // first control instead of leaving it on <body>.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        // Operators have no Reopen button: fall back to the page heading.
        const target = isClosed ? reopenBtnRef.current : cashOnHandInputRef.current;
        (target ?? pageHeadingRef.current)?.focus();
      });
    }
  }, [
    pendingStatusTarget,
    isClosed,
    initialCashOnHandInput,
    initialTngOnHandInput,
    initialCloseNote,
    initialConfirmEmpty,
  ]);


  useEffect(() => {
    return registerGuard({
      isDirty: () => isCloseDraftDirtyRef.current || submittingRef.current,
      onRequestLeave: ({ href, historyDelta, triggerEl }) => {
        if (submittingRef.current) return;
        const fallbackFocus = isClosedRef.current
          ? (reopenReasonRef.current ?? reopenBtnRef.current)
          : cashOnHandInputRef.current;
        const resolvedReturnFocus =
          triggerEl ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        setPendingNavigation({
          href,
          historyDelta,
          returnFocusTo: resolvedReturnFocus ?? fallbackFocus,
        });
      },
    });
  }, [registerGuard]);

  useEffect(() => {
    if (!isCloseDraftDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isCloseDraftDirty]);

  useModalFocusTrap({
    isOpen: pendingNavigation !== null,
    containerRef: discardModalRef,
    onClose: () => setPendingNavigation(null),
    returnFocusTo: pendingNavigation?.returnFocusTo ?? null,
    fallbackFocusRef: isClosed ? reopenReasonRef : cashOnHandInputRef,
  });

  function showSuccessMessage(message: string) {
    if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
    setSuccessMessage(message);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      setSuccessMessage(null);
    }, 3500);
  }

  // A retry keeps the saved-but-stale notice (and its focused button) mounted
  // and shows progress in place, instead of unmounting it mid-request.
  async function runStatusRefresh(target: "closed" | "open", isRetry = false) {
    const attempt = ++refreshAttemptRef.current;
    setPendingStatusTarget(target);
    if (isRetry) {
      setRetryingRefresh(true);
    } else {
      setRefreshFailed(false);
      setRetryFailedOnce(false);
    }
    let failed = false;
    try {
      const result = refresh({ quiet: true });
      if (result && typeof (result as Promise<unknown>).then === "function") {
        failed = (await result) === false;
      }
    } catch {
      failed = true;
    }
    if (attempt !== refreshAttemptRef.current) return;
    if (isRetry) {
      setRetryingRefresh(false);
      // Either the read failed or it still showed the old status (the notice
      // is cleared by the status effect if the expected status landed).
      setRetryFailedOnce(true);
    } else if (failed) {
      setRefreshFailed(true);
    }
  }

  async function handlePerformClose(e: React.FormEvent) {
    e.preventDefault();
    if (isTransitioning) return;
    await submitMonthClose({
      submitting: isTransitioning,
      gating,
      currentMonth,
      closeNote,
      confirmEmpty,
      t,
      setErrorMessage,
      setSubmitting,
      setSuccessMessage,
      showSuccessMessage,
      // Keep the submitted count on screen (read-only) until the closed record
      // lands; the reset happens then, so a later reopen starts fresh.
      // Not in a transition: pendingStatusTarget must commit with (urgent)
      // setSubmitting(false), or the form would briefly unlock in between.
      onClosed: () => {
        void runStatusRefresh("closed");
      },
    });
  }

  async function handlePerformReopen(e: React.FormEvent) {
    e.preventDefault();
    if (isTransitioning) return;
    setErrorMessage(null);
    setReopenReasonError(null);

    if (!reopenReasonInput.trim()) {
      setReopenReasonError(t.reopenReasonRequired);
      requestAnimationFrame(() => reopenReasonRef.current?.focus());
      return;
    }

    setSubmitting(true);

    try {
      const res = await apiFetch("/api/close/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          reason: reopenReasonInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error ?? ""), { code: data.code });
      }

      setShowReopenBox(false);
      setReopenReasonInput("");
      setReopenReasonError(null);
      setCashOnHandInput(initialCashOnHandInput);
      setTngOnHandInput(initialTngOnHandInput);
      setCloseNote(initialCloseNote);
      setConfirmEmpty(initialConfirmEmpty);
      showSuccessMessage(t.reopenSuccess);

      void runStatusRefresh("open");
    } catch (err) {
      setErrorMessage(translateApiError(apiErrorPayloadFrom(err), t));
    } finally {
      setSubmitting(false);
    }
  }

  // Shown beside the action that just saved, from the acknowledged write until
  // the refreshed record lands: "updating" while the refresh runs, then
  // "hasn't caught up" + Retry if it fails. Stacks below sm so the copy keeps
  // its width at 320-390px.
  const spinner = (
    <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  const staleStatusNotice =
    pendingStatusTarget !== null && !refreshFailed && !submitting ? (
      <div className="flex items-center gap-2 p-3.5 rounded-xl bg-surface-subtle border border-surface-border text-sm text-ink-secondary font-semibold">
        {spinner}
        <span>{pendingStatusTarget === "closed" ? t.closeSavedUpdating : t.reopenSavedUpdating}</span>
      </div>
    ) : refreshFailed && pendingStatusTarget !== null ? (
      <div
        role="alert"
        className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between p-3.5 rounded-xl bg-status-reopened-bg border border-status-reopened/20 text-sm text-status-reopened font-semibold"
      >
        <span>
          {pendingStatusTarget === "closed" ? t.closeSavedStatusStale : t.reopenSavedStatusStale}
          {retryFailedOnce && <span className="block mt-0.5 font-medium">{t.refreshStillFailing}</span>}
        </span>
        <button
          ref={staleRetryRef}
          type="button"
          aria-disabled={retryingRefresh}
          aria-busy={retryingRefresh}
          onClick={() => {
            if (!retryingRefresh) void runStatusRefresh(pendingStatusTarget, true);
          }}
          className="shrink-0 min-h-[44px] w-full sm:w-auto sm:min-w-[9.5rem] px-4 rounded-xl border border-status-reopened/30 bg-surface hover:bg-surface-subtle btn-tactile text-sm font-semibold inline-flex items-center justify-center gap-1.5 aria-disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
        >
          {retryingRefresh && spinner}
          {retryingRefresh ? t.refreshingStatus : t.retry}
        </button>
      </div>
    ) : null;

  return (
    <>
      <span
        data-inert-exempt="true"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {submitting
          ? isClosed
            ? t.reopening
            : t.closingMonth
          : pendingStatusTarget !== null && !refreshFailed
            ? pendingStatusTarget === "closed"
              ? t.closeSavedUpdating
              : t.reopenSavedUpdating
            : successMessage ?? ""}
      </span>

      <div className="space-y-6">
      {/* Header & Month Selector — Stacks cleanly on narrow mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 ref={pageHeadingRef} tabIndex={-1} className="text-2xl font-bold text-ink-primary tracking-tight focus:outline-none">
          {t.closeTitle}
        </h1>

        <MonthSelectorDropdown
          currentMonth={currentMonth}
          disabled={submitting}
          options={(
            monthOptions ||
            availableMonths.map((m) => ({
              month: m,
              status:
                m === currentMonth
                  ? isClosed
                    ? "closed"
                    : isReopened
                    ? "reopened"
                    : "open"
                  : "open",
            }))
          ).map((o) =>
            // The write is acknowledged: show its status before the refresh lands.
            o.month === currentMonth && pendingStatusTarget !== null
              ? { ...o, status: pendingStatusTarget === "closed" ? "closed" : "reopened" }
              : o,
          )}
          onSelect={(month, triggerEl) => {
            if (month === currentMonth) return;
            if (submitting) return;
            const targetHref = `/close?month=${month}`;
            if (isCloseDraftDirty) {
              setPendingNavigation({
                href: targetHref,
                returnFocusTo:
                  triggerEl ??
                  (isClosed
                    ? (reopenReasonRef.current ?? reopenBtnRef.current)
                    : cashOnHandInputRef.current),
                isMonthSwitch: true,
              });
              return false;
            }
            router.push(targetHref);
          }}
        />
      </div>

      {loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="p-5 rounded-2xl bg-finance-loss-light border border-finance-loss-border text-finance-loss space-y-1.5 shadow-card"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-sm font-bold text-finance-loss">{t.loadError}</h3>
          </div>
          <p className="text-xs text-ink-secondary">{loadError}</p>
        </div>
      ) : (
        <>
          {successMessage && (
            <div className="py-2.5 px-4 rounded-xl bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center justify-between gap-2 shadow-card animate-slide-down">
              <div className="flex items-start gap-2 min-w-0">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="break-words whitespace-normal">{successMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (successTimerRef.current !== null) {
                    clearTimeout(successTimerRef.current);
                    successTimerRef.current = null;
                  }
                  setSuccessMessage(null);
                }}
                className="text-xs font-bold text-ink-muted hover:text-brand-broccoli min-w-[44px] min-h-[44px] -my-2 -mr-2 flex items-center justify-center rounded-lg shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                aria-label={t.closeLabel}
              >
                ✕
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              ref={errorAlertRef}
              role="alert"
              className="py-2.5 px-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between gap-2 shadow-card animate-slide-down"
            >
              <div className="flex items-start gap-2 min-w-0">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="break-words whitespace-normal">{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-xs font-bold text-ink-muted hover:text-finance-loss min-w-[44px] min-h-[44px] -my-2 -mr-2 flex items-center justify-center rounded-lg shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60"
                aria-label={t.closeLabel}
              >
                ✕
              </button>
            </div>
          )}

          {/* Grounded 2-Column Layout on Desktop (No Stretched Empty Holes) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left 5 Cols: Accounting Waterfall Statement (Net Profit sits directly below deductions) */}
            {financials && (
              <section
                aria-label={t.bookSummaryTitle}
                className="lg:col-span-5 lg:sticky lg:top-8 bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden"
              >
                <div className="px-5 py-4 sm:px-6 border-b border-surface-border flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-ink-primary whitespace-nowrap">
                    {t.bookSummaryTitle}
                  </h2>
                  {financials.revenueSen > 0 && (
                    <span
                      className={`text-sm font-semibold num-tabular whitespace-nowrap shrink-0 ${
                        expectedNetSen >= 0n ? "text-finance-profit" : "text-finance-loss"
                      }`}
                    >
                      {t.profitMargin}{" "}
                      {(() => {
                        const pct = Math.round((financials.netSen / financials.revenueSen) * 1000) / 10;
                        return pct < 0 ? `\u2212${Math.abs(pct)}%` : `${pct}%`;
                      })()}
                    </span>
                  )}
                </div>

                <div className="p-5 sm:px-6 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-secondary">{t.totalRevenue}</span>
                    <MoneyValue
                      sen={BigInt(financials.revenueSen)}
                      className="font-semibold text-ink-primary"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-muted">{t.costsTitle}</span>
                    <span
                      className={`font-semibold num-tabular ${
                        financials.dailyCostSen > 0 ? "text-finance-loss" : "text-ink-secondary"
                      }`}
                    >
                      {financials.dailyCostSen > 0 ? "\u2212" : ""}
                      <MoneyValue sen={BigInt(financials.dailyCostSen)} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-dashed border-surface-border">
                    <span className="text-ink-primary font-semibold">{t.monthGrossProfit}</span>
                    <MoneyValue
                      sen={BigInt(financials.grossSen)}
                      className={`font-bold ${
                        financials.grossSen < 0 ? "text-finance-loss" : "text-ink-primary"
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-muted">{t.operatingExpenses}</span>
                    <span
                      className={`font-semibold num-tabular ${
                        financials.operatingSen > 0 ? "text-finance-loss" : "text-ink-secondary"
                      }`}
                    >
                      {financials.operatingSen > 0 ? "\u2212" : ""}
                      <MoneyValue sen={BigInt(financials.operatingSen)} />
                    </span>
                  </div>
                </div>

                <div className="px-5 py-4 sm:px-6 border-t border-surface-border bg-surface-subtle/50 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-bold text-ink-secondary">
                    {t.expectedNet}
                  </span>
                  <span
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      expectedNetSen >= 0n ? "text-finance-profit" : "text-finance-loss"
                    }`}
                  >
                    <MoneyValue sen={expectedNetSen} variant="metric" />
                  </span>
                </div>
              </section>
            )}

            {/* Right 7 Cols: Closed Audit OR Open Reconciliation Centerpiece */}
            <div className={financials ? "lg:col-span-7 flex flex-col" : "lg:col-span-12"}>
              {/* Case 1: CLOSED */}
              {isClosed && (
                <section
                  aria-label={t.reconciliationSection}
                  className="flex-1 bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-5"
                >
                  <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-surface-border">
                    {/* After an acknowledged reopen the heading follows the write; the
                        figures below are labelled as the previous close snapshot. */}
                    <div
                      className={`flex items-center gap-2.5 font-bold text-sm ${
                        pendingStatusTarget === "open" ? "text-status-reopened" : "text-status-closed"
                      }`}
                    >
                      <span
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          pendingStatusTarget === "open" ? "bg-status-reopened-bg" : "bg-status-closed-bg"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                          {pendingStatusTarget === "open" ? (
                            // Open padlock: the shackle lifted, matching "Month reopened"
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 017.9-1" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          )}
                        </svg>
                      </span>
                      <span>{pendingStatusTarget === "open" ? t.reopenedShowingPreviousClose : t.monthLocked}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                    <div className="p-3.5 rounded-xl bg-surface-subtle/50 border border-surface-border">
                      <span className="text-ink-muted block text-xs mb-1">{t.cashOnHand}</span>
                      <MoneyValue
                        sen={BigInt(closeRecord?.cashOnHandSen ?? 0)}
                        className="font-bold text-ink-primary text-base"
                      />
                    </div>
                    <div className="p-3.5 rounded-xl bg-surface-subtle/50 border border-surface-border">
                      <span className="text-ink-muted block text-xs mb-1">{t.tngOnHand}</span>
                      <MoneyValue
                        sen={BigInt(closeRecord?.tngOnHandSen ?? 0)}
                        className="font-bold text-ink-primary text-base"
                      />
                    </div>
                    <div className="p-3.5 rounded-xl bg-surface-subtle/50 border border-surface-border">
                      <span className="text-ink-muted block text-xs mb-1">{t.actualTotal}</span>
                      <MoneyValue
                        sen={BigInt(closeRecord?.actualSen ?? 0)}
                        className="font-bold text-ink-primary text-base"
                      />
                    </div>
                    <div className="p-3.5 rounded-xl bg-surface-subtle/50 border border-surface-border">
                      <span className="text-ink-muted block text-xs mb-1">{t.reconciliationDiff}</span>
                      <span
                        className={`font-bold text-base ${
                          closeRecord?.balanced ? "text-finance-profit" : "text-finance-loss"
                        }`}
                      >
                        {closeRecord?.balanced ? (
                          t.reconciliationBalanced
                        ) : (
                          <MoneyValue sen={BigInt(closeRecord?.differenceSen ?? 0)} showPlus />
                        )}
                      </span>
                    </div>
                  </div>

                  {closeRecord?.note && (
                    <div className="text-sm bg-surface-subtle p-4 rounded-xl border border-surface-border">
                      <span className="font-semibold text-ink-secondary block mb-1 text-xs">{t.closeNote}</span>
                      <span className="text-ink-primary break-words whitespace-normal">{closeRecord.note}</span>
                    </div>
                  )}

                  {closeRecord?.closedAt && (
                    <div className="text-xs text-ink-muted num-tabular">
                      {t.closedAtLabel}{lang === "zh" ? "：" : ": "}{closeRecord.closedAt}
                    </div>
                  )}

                  {/* Admin Reopen Section */}
                  {userRole === "Admin" && (
                    <div data-close-action-area className="pt-4 border-t border-surface-border space-y-3">
                      {pendingStatusTarget === "open" && staleStatusNotice}
                      {!showReopenBox ? (
                        <button
                          ref={reopenBtnRef}
                          type="button"
                          disabled={isTransitioning}
                          onClick={() => {
                            setErrorMessage(null);
                            setReopenReasonError(null);
                            setShowReopenBox(true);
                            requestAnimationFrame(() => reopenReasonRef.current?.focus());
                          }}
                          className="min-h-[48px] px-4 rounded-xl border border-surface-border-strong hover:bg-surface-subtle btn-tactile text-sm font-semibold text-ink-secondary hover:text-ink-primary disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                        >
                          {t.reopenTitle}
                        </button>
                      ) : (
                        <form onSubmit={handlePerformReopen} noValidate className="space-y-3 bg-surface-subtle/60 p-4 rounded-xl border border-surface-border">
                          <label htmlFor="reopen-reason-input" className="block text-sm font-semibold text-ink-primary">
                            {t.reopenReason} <span className="text-finance-loss">*</span>
                          </label>
                          <input
                            ref={reopenReasonRef}
                            id="reopen-reason-input"
                            type="text"
                            required
                            disabled={isTransitioning}
                            aria-required="true"
                            aria-invalid={reopenReasonError !== null || undefined}
                            aria-describedby={reopenReasonError ? "reopen-reason-error" : undefined}
                            value={reopenReasonInput}
                            onChange={(e) => {
                              setReopenReasonInput(e.target.value);
                              if (reopenReasonError) setReopenReasonError(null);
                              if (errorMessage) setErrorMessage(null);
                            }}
                            placeholder={t.reopenPlaceholder}
                            className={`w-full h-12 px-3.5 rounded-xl bg-surface-input border text-base sm:text-sm [@media(pointer:coarse)]:text-base text-ink-primary focus:outline-none focus:bg-surface focus-visible:ring-2 disabled:opacity-100 disabled:bg-surface-subtle disabled:text-ink-secondary disabled:border-surface-border disabled:cursor-default transition-colors ${
                              reopenReasonError
                                ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                : "border-surface-border-strong focus:border-brand-broccoli focus-visible:ring-brand-broccoli/40"
                            }`}
                          />
                          {reopenReasonError && (
                            <p
                              id="reopen-reason-error"
                              role="alert"
                              className="py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium break-words whitespace-normal"
                            >
                              {reopenReasonError}
                            </p>
                          )}
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={isTransitioning}
                              onClick={() => {
                                setErrorMessage(null);
                                setReopenReasonInput("");
                                setReopenReasonError(null);
                                setShowReopenBox(false);
                                requestAnimationFrame(() => reopenBtnRef.current?.focus());
                              }}
                              className="min-h-[48px] px-4 rounded-xl border border-surface-border bg-surface hover:bg-surface-subtle btn-tactile text-ink-secondary text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                            >
                              {t.cancel}
                            </button>
                            <button
                              type="submit"
                              disabled={isTransitioning}
                              className="min-h-[48px] px-5 rounded-xl bg-brand-cta hover:bg-brand-cta-hover text-brand-cta-ink btn-tactile font-semibold text-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                            >
                              {submitting ? t.reopening : t.btnPerformReopen}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Case 2: OPEN or REOPENED */}
              {!isClosed && (
                <form
                  onSubmit={handlePerformClose}
                  className="flex-1 bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-5 flex flex-col justify-between"
                >
                  <div className="space-y-5">
                    {/* Clean Stacked Header — Zero Collision on 320px/390px */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-bold text-ink-primary">
                        {t.reconciliationSection}
                      </h2>
                      <span
                        aria-live="polite"
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          hasParseError
                            ? "bg-finance-loss-light text-finance-loss border-finance-loss-border"
                            : isAwaitingCount
                            ? "bg-surface-subtle text-ink-muted border-surface-border"
                            : isBalanced
                            ? "bg-finance-profit-light text-finance-profit border-finance-profit-border"
                            : "bg-finance-cost-light text-finance-cost border-finance-cost/30"
                        }`}
                      >
                        {hasParseError
                          ? t.invalidAmount
                          : isAwaitingCount
                          ? t.reconciliationAwaiting
                          : isBalanced
                          ? t.reconciliationBalanced
                          : t.reconciliationMismatch}
                      </span>
                    </div>

                    {/* History banner; hidden once a new close is acknowledged so the
                        page never says "Reopened" and "Month closed" at once. */}
                    {isReopened && closeRecord?.reopenReason && pendingStatusTarget !== "closed" && (
                      <div className="p-3.5 rounded-xl bg-status-reopened-bg border border-status-reopened/20 text-sm">
                        <span className="font-semibold text-status-reopened block mb-0.5">
                          {t.reopenedStatus} ({closeRecord.reopenedAt?.slice(0, 10)})
                        </span>
                        <span className="text-ink-secondary break-words whitespace-normal">
                          {t.reasonLabel}{lang === "zh" ? "：" : ": "}{closeRecord.reopenReason}
                        </span>
                      </div>
                    )}

                    {/* Cash & TnG Counted Inputs with Explicit Labels and Unified Icons */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-7 h-7 rounded-lg bg-channel-cash-light text-channel-cash flex items-center justify-center shrink-0">
                            <CashIcon className="w-4 h-4" />
                          </span>
                          <label htmlFor="close-cash-input" className="text-sm font-semibold text-ink-primary">
                            {t.cashOnHand}
                          </label>
                        </div>
                        <div className="relative flex items-center">
                          <span className="absolute left-3.5 text-sm font-bold text-channel-cash select-none">
                            RM
                          </span>
                          <input
                            ref={cashOnHandInputRef}
                            id="close-cash-input"
                            type="text"
                            inputMode="decimal"
                            disabled={isTransitioning}
                            value={cashOnHandInput}
                            aria-invalid={cashError || undefined}
                            aria-describedby={cashError ? "close-cash-error" : undefined}
                            onChange={(e) => {
                              const sanitized = sanitizeMoneyInput(e.target.value);
                              if (sanitized !== null) {
                                setCashOnHandInput(sanitized);
                                if (errorMessage) setErrorMessage(null);
                              }
                            }}
                            placeholder="0.00"
                            className={`w-full h-14 pl-11 pr-3.5 rounded-xl bg-surface-input border ${
                              cashError ? "border-finance-loss" : "border-surface-border-strong"
                            } text-xl font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface ${
                              cashError
                                ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                : "focus:border-channel-cash focus-visible:ring-channel-cash/30"
                            } focus-visible:ring-2 disabled:opacity-100 disabled:bg-surface-subtle disabled:text-ink-secondary disabled:border-surface-border disabled:cursor-default transition-colors`}
                          />
                        </div>
                        {cashError && (
                          <div
                            id="close-cash-error"
                            role="alert"
                            className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium"
                          >
                            <span>{t.invalidAmount}</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-7 h-7 rounded-lg bg-channel-tng-light text-channel-tng flex items-center justify-center shrink-0">
                            <TngIcon className="w-4 h-4" />
                          </span>
                          <label htmlFor="close-tng-input" className="text-sm font-semibold text-ink-primary">
                            {t.tngOnHand}
                          </label>
                        </div>
                        <div className="relative flex items-center">
                          <span className="absolute left-3.5 text-sm font-bold text-channel-tng select-none">
                            RM
                          </span>
                          <input
                            id="close-tng-input"
                            type="text"
                            inputMode="decimal"
                            disabled={isTransitioning}
                            value={tngOnHandInput}
                            aria-invalid={tngError || undefined}
                            aria-describedby={tngError ? "close-tng-error" : undefined}
                            onChange={(e) => {
                              const sanitized = sanitizeMoneyInput(e.target.value);
                              if (sanitized !== null) {
                                setTngOnHandInput(sanitized);
                                if (errorMessage) setErrorMessage(null);
                              }
                            }}
                            placeholder="0.00"
                            className={`w-full h-14 pl-11 pr-3.5 rounded-xl bg-surface-input border ${
                              tngError ? "border-finance-loss" : "border-surface-border-strong"
                            } text-xl font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface ${
                              tngError
                                ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                : "focus:border-channel-tng focus-visible:ring-channel-tng/30"
                            } focus-visible:ring-2 disabled:opacity-100 disabled:bg-surface-subtle disabled:text-ink-secondary disabled:border-surface-border disabled:cursor-default transition-colors`}
                          />
                        </div>
                        {tngError && (
                          <div
                            id="close-tng-error"
                            role="alert"
                            className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium"
                          >
                            <span>{t.invalidAmount}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live Reconciliation Comparison Panel — Calm Neutral Before Input */}
                    <div
                      aria-live="polite"
                      className="p-4 rounded-xl bg-surface-subtle/60 border border-surface-border space-y-2.5"
                    >
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="block text-xs text-ink-muted mb-0.5">
                            {t.actualTotal}
                          </span>
                          <span className="font-bold text-ink-primary text-base num-tabular">
                            {!isAwaitingCount && actualCountedSen !== null ? (
                              <MoneyValue sen={actualCountedSen} />
                            ) : (
                              "—"
                            )}
                          </span>
                          {hasPartialInput && !hasParseError && (
                            <span className="block text-[11px] text-ink-muted mt-0.5">
                              {t.blankCountsZeroHint}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="block text-xs text-ink-muted mb-0.5">
                            {t.expectedNet}
                          </span>
                          <MoneyValue
                            sen={expectedNetSen}
                            className="font-bold text-ink-primary text-base"
                          />
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-surface-border flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-semibold text-ink-secondary">
                          {t.reconciliationDiff}
                        </span>
                        {isAwaitingCount ? (
                          <span className="text-xs text-ink-muted">
                            {t.reconciliationAwaitingHint}
                          </span>
                        ) : hasParseError || varianceSen === null ? (
                          <span className="font-bold text-base text-ink-muted num-tabular">
                            —
                          </span>
                        ) : isBalanced ? (
                          <span className="font-bold text-base text-finance-profit num-tabular">
                            <MoneyValue sen={0n} />
                          </span>
                        ) : (
                          <span className="font-bold text-base text-finance-loss num-tabular">
                            {varianceSen < 0n ? t.reconciliationShortBy : t.reconciliationOverBy}{" "}
                            <MoneyValue sen={varianceSen < 0n ? -varianceSen : varianceSen} />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Close Note */}
                    <div>
                      <label htmlFor="close-note-input" className="block text-xs font-semibold text-ink-secondary mb-1.5">
                        {t.closeNote}{lang === "zh" ? "" : " "}
                        {!isBalanced && hasInputs && !hasParseError && (
                          <span className="text-finance-loss">
                            {lang === "zh" ? `（${t.noteRequiredBadge}）` : `(${t.noteRequiredBadge})`}
                          </span>
                        )}
                      </label>
                      <input
                        id="close-note-input"
                        type="text"
                        disabled={isTransitioning}
                        value={closeNote}
                        onChange={(e) => {
                          setCloseNote(e.target.value);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        aria-required={(!isBalanced && hasInputs && !hasParseError) || undefined}
                        aria-describedby={
                          !isBalanced && hasInputs && !hasParseError
                            ? "close-note-hint"
                            : undefined
                        }
                        placeholder={
                          !isBalanced && hasInputs && !hasParseError
                            ? t.closeNoteExample
                            : t.closeNoteOptional
                        }
                        className="w-full h-12 px-3.5 rounded-xl bg-surface-input border border-surface-border-strong text-base sm:text-sm [@media(pointer:coarse)]:text-base text-ink-primary focus:outline-none focus:bg-surface focus:border-brand-broccoli focus-visible:ring-2 focus-visible:ring-brand-broccoli/30 disabled:opacity-100 disabled:bg-surface-subtle disabled:text-ink-secondary disabled:border-surface-border disabled:cursor-default transition-colors"
                      />
                      {!isBalanced && hasInputs && !hasParseError && (
                        <p
                          id="close-note-hint"
                          className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium ${
                            errorMessage ? "text-finance-loss" : "text-finance-cost"
                          }`}
                        >
                          <svg
                            aria-hidden="true"
                            className="w-3.5 h-3.5 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                          <span>{t.closeNotePlaceholder}</span>
                        </p>
                      )}
                    </div>

                    {/* Empty Month Confirmation */}
                    {!hasSheetsInMonth && (
                      <label className="flex items-center gap-2.5 min-h-[44px] text-sm font-medium text-ink-secondary cursor-pointer select-none py-1">
                        <input
                          type="checkbox"
                          disabled={isTransitioning}
                          checked={confirmEmpty}
                          onChange={(e) => setConfirmEmpty(e.target.checked)}
                          className="w-5 h-5 rounded border-surface-border-strong accent-brand-broccoli cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                        />
                        <span>{t.confirmEmptyMonth}</span>
                      </label>
                    )}
                  </div>

                  {/* Action Footer: Close Month aligns strictly with Reconciliation readiness */}
                  <div data-close-action-area className="space-y-2.5 pt-2">
                    {/* Once the close is acknowledged, the notice takes the button's place */}
                    {pendingStatusTarget !== "closed" && (
                    <button
                      type="submit"
                      disabled={!canSubmitClose}
                      className="w-full h-12 rounded-xl bg-brand-cta hover:bg-brand-cta-hover btn-tactile text-brand-cta-ink font-semibold text-sm tracking-wide shadow-card flex items-center justify-center disabled:bg-surface-subtle disabled:text-ink-muted disabled:border disabled:border-surface-border disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                    >
                      {submitting ? t.closingMonth : t.btnPerformClose}
                    </button>
                    )}

                    {pendingStatusTarget === "closed" && staleStatusNotice ? (
                      staleStatusNotice
                    ) : (
                      <p className="text-xs text-ink-muted text-center">
                        {closeReadinessHint ?? t.closeWarning}
                      </p>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      )}
      {/* Unsaved Month Close Draft Guard Modal */}
      {pendingNavigation !== null && (
        <div
          ref={discardModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-close-title"
          aria-describedby="discard-close-desc"
          className="fixed inset-0 !mt-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingNavigation(null);
          }}
        >
          <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface rounded-2xl p-6 shadow-popover border border-surface-border space-y-5">
            <div className="space-y-1.5">
              <h3 id="discard-close-title" className="text-lg font-bold text-ink-primary">
                {t.discardUnsavedTitle}
              </h3>
              <p id="discard-close-desc" className="text-[13px] text-ink-muted leading-relaxed">
                {pendingNavigation.isMonthSwitch
                  ? t.discardUnsavedCloseMonthDesc
                  : t.discardUnsavedCloseDesc}
              </p>
            </div>

            <div className="flex items-stretch gap-2.5 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setPendingNavigation(null)}
                className="flex-1 min-h-[48px] px-3 py-2 text-center leading-snug rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                {t.keepEditingBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingNavigation;
                  setPendingNavigation(null);
                  setCashOnHandInput(initialCashOnHandInput);
                  setTngOnHandInput(initialTngOnHandInput);
                  setCloseNote(initialCloseNote);
                  setConfirmEmpty(initialConfirmEmpty);
                  setShowReopenBox(false);
                  setReopenReasonInput("");
                  setReopenReasonError(null);
                  if (typeof target.historyDelta === "number") {
                    proceedHistoryNavigation(target.historyDelta);
                  } else {
                    router.push(target.href);
                  }
                }}
                className="flex-1 min-h-[48px] px-3 py-2 text-center leading-snug rounded-xl bg-danger-cta hover:bg-danger-cta-hover btn-tactile text-danger-cta-ink font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
              >
                {pendingNavigation.isMonthSwitch
                  ? t.discardAndSwitchMonthBtn
                  : t.discardAndSwitchBtn}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
