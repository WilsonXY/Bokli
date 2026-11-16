"use client";

import Link from "next/link";
import { ActionIcon } from "./ActionIcon";
import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, sanitizeMoneyInput, tryParseSen } from "@/lib/money";
import { useDraftCache } from "@/components/DraftProvider";
import { apiFetch } from "@/lib/cloud-client";
import { useI18n, translateApiError, apiErrorPayloadFrom, type TranslationMap } from "@/lib/i18n";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";

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
  /** Cloud build: re-fetch the page data; router.refresh() only re-renders a static page. */
  onRefresh?: () => void;
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

    setSuccessMessage(t.closeSuccess);
    setTimeout(() => setSuccessMessage(null), 3500);

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
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  const [cachedDraft, rememberDraft] = useDraftCache<{ cash: string; tng: string; note: string; confirmEmpty: boolean; reopenReason: string; reopenOpen: boolean }>(`close:${currentMonth}`);
  const restoredDraft = closeRecord?.isClosed ? undefined : cachedDraft;

  // Input state for reconciliation
  const [cashOnHandInput, setCashOnHandInput] = useState(restoredDraft?.cash ?? initialCashOnHandInput);
  const [tngOnHandInput, setTngOnHandInput] = useState(restoredDraft?.tng ?? initialTngOnHandInput);
  const [closeNote, setCloseNote] = useState(restoredDraft?.note ?? initialCloseNote);
  const [confirmEmpty, setConfirmEmpty] = useState(restoredDraft?.confirmEmpty ?? initialConfirmEmpty);

  // Admin reopen state
  const [showReopenBox, setShowReopenBox] = useState(userRole === "Admin" && Boolean(cachedDraft?.reopenOpen));
  const [reopenReasonInput, setReopenReasonInput] = useState(userRole === "Admin" ? cachedDraft?.reopenReason ?? "" : "");

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
  const countsComplete = cashOnHandInput.trim() !== "" && tngOnHandInput.trim() !== "";

  const isClosed = Boolean(closeRecord?.isClosed);
  const isReopened = Boolean(closeRecord?.isReopened);

  useEffect(() => {
    const dirty = (!isClosed && (cashOnHandInput.trim() || tngOnHandInput.trim() || closeNote.trim() || confirmEmpty)) || (userRole === "Admin" && isClosed && reopenReasonInput.trim());
    rememberDraft(dirty ? { cash: cashOnHandInput, tng: tngOnHandInput, note: closeNote, confirmEmpty, reopenReason: reopenReasonInput, reopenOpen: showReopenBox } : null);
  }, [rememberDraft, isClosed, userRole, cashOnHandInput, tngOnHandInput, closeNote, confirmEmpty, reopenReasonInput, showReopenBox]);

  // Handle Month Close submission
  async function handlePerformClose(e: React.FormEvent) {
    e.preventDefault();
    await submitMonthClose({
      submitting,
      gating,
      currentMonth,
      closeNote,
      confirmEmpty,
      t,
      setErrorMessage,
      setSubmitting,
      setSuccessMessage,
      onClosed: () => {
        rememberDraft(draft => draft && (draft.cash !== cashOnHandInput || draft.tng !== tngOnHandInput || draft.note !== closeNote || draft.confirmEmpty !== confirmEmpty) ? draft : null);
        startTransition(() => {
          refresh();
        });
      },
    });
  }

  // Handle Admin Reopen
  async function handlePerformReopen(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMessage(null);

    if (!reopenReasonInput.trim()) {
      setErrorMessage(t.reopenReasonRequired);
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

      rememberDraft(draft => draft && (draft.reopenReason !== reopenReasonInput || draft.cash !== cashOnHandInput || draft.tng !== tngOnHandInput || draft.note !== closeNote) ? draft : null);
      setShowReopenBox(false);
      setReopenReasonInput("");
      setSuccessMessage(t.reopenSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);

      startTransition(() => {
        refresh();
      });
    } catch (err) {
      setErrorMessage(translateApiError(apiErrorPayloadFrom(err), t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="close-layout page-stack">
      <Link className="mobile-back-link" href={`/dashboard?month=${currentMonth}`}><span aria-hidden="true">‹</span>{t.navDashboard}</Link>
      {/* Page heading and period selection */}
      <div className="page-heading">
        <div><h1 className="text-xl font-bold text-ink-primary tracking-tight">
          {t.closeTitle}
        </h1>{!isClosed && <p className="page-description">{t.closeHint}</p>}</div>

        {/* Month Dropdown */}
        <MonthSelectorDropdown
          currentMonth={currentMonth}
          options={
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
          }
          onSelect={(month) => router.push(`/close?month=${month}`)}
        />
      </div>

      {loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-sm font-bold text-finance-loss">
              {t.loadError}
            </h3>
          </div>
          <p className="text-xs text-ink-secondary">
            {loadError}
          </p>
        </div>
      ) : (
        <>
          {/* Success Notification */}
          {successMessage && (
            <div className="py-2.5 px-3.5 rounded-xl bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{successMessage}</span>
            </div>
          )}

          {financials && <section className="close-expectation" aria-label="Month Financial Snapshot">
            <div className="close-expected-total"><span>{t.expectedNet}</span><strong className={expectedNetSen >= 0n ? "text-finance-profit" : "text-finance-loss"}>{formatMyr(expectedNetSen)}</strong></div>
            <details className="close-calculation"><summary>{t.viewCalculation}<span className="calculation-chevron" aria-hidden="true"><ActionIcon name="chevronDown" size={20} /></span></summary><dl>
              <div><dt>{t.totalRevenue}</dt><dd>{formatMyr(BigInt(financials.revenueSen))}</dd></div>
              <div><dt>{t.costsTitle}</dt><dd>{formatMyr(-BigInt(financials.dailyCostSen))}</dd></div>
              <div><dt>{t.operatingExpenses}</dt><dd>{formatMyr(-BigInt(financials.operatingSen))}</dd></div>
            </dl></details>
          </section>}

          {/* Case 1: Month is CLOSED */}
          {isClosed && (
            <section aria-label="Closed Month Reconciliation Audit" className="bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-3.5">
              <div className="closed-audit-heading" role="status" aria-label={t.monthLocked}>
                <ActionIcon name="lock" size={18} /><span>{t.closedStatus}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-ink-muted block text-xs mb-0.5 font-medium">{t.cashOnHand}</span>
                  <span className="font-bold text-ink-primary text-base tabular-nums">
                    {formatMyr(BigInt(closeRecord?.cashOnHandSen ?? 0))}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted block text-xs mb-0.5 font-medium">{t.tngOnHand}</span>
                  <span className="font-bold text-ink-primary text-base tabular-nums">
                    {formatMyr(BigInt(closeRecord?.tngOnHandSen ?? 0))}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted block text-xs mb-0.5 font-medium">{t.actualTotal}</span>
                  <span className="font-bold text-ink-primary text-base tabular-nums">
                    {formatMyr(BigInt(closeRecord?.actualSen ?? 0))}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted block text-xs mb-0.5 font-medium">{t.reconciliationDiff}</span>
                  <span
                    className={`font-bold text-base tabular-nums ${
                      closeRecord?.balanced ? "text-brand-broccoli" : "text-finance-loss"
                    }`}
                  >
                    {closeRecord?.balanced ? t.reconciliationBalanced : formatMyr(BigInt(closeRecord?.differenceSen ?? 0))}
                  </span>
                </div>
              </div>

              {closeRecord?.note && (
                <div className="text-sm bg-surface-subtle p-3 rounded-lg border border-surface-border">
                  <span className="font-semibold text-ink-secondary block mb-0.5">{t.closeNote}:</span>
                  <span className="text-ink-primary">{closeRecord.note}</span>
                </div>
              )}

              {closeRecord?.closedAt && (
                <div className="text-xs text-ink-muted tabular-nums">
                  {t.closedAtLabel}: {closeRecord.closedAt}
                </div>
              )}

              {/* Admin Reopen Section */}
              {userRole === "Admin" && (
                <div className="pt-2 border-t border-surface-border">
                  {!showReopenBox ? (
                    <button
                      type="button"
                      onClick={() => setShowReopenBox(true)}
                      className="min-h-[44px] px-3.5 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-sm font-semibold text-ink-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
                    >
                      {t.reopenTitle}
                    </button>
                  ) : (
                    <form onSubmit={handlePerformReopen} className="space-y-2.5 bg-surface-subtle p-3 rounded-lg border border-surface-border">
                      <label htmlFor="reopen-reason" className="block text-sm font-semibold text-ink-primary">
                        {t.reopenReason} <span className="text-finance-loss">*</span>
                      </label>
                      <input id="reopen-reason" disabled={submitting} type="text"
                        value={reopenReasonInput}
                        onChange={(e) => setReopenReasonInput(e.target.value)}
                        placeholder={t.reopenPlaceholder}
                        className="w-full h-11 px-3 rounded-lg bg-white border border-surface-border text-sm text-ink-primary focus:outline-none focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="min-h-[44px] px-4 rounded-lg bg-status-closed text-white btn-wave font-semibold text-sm transition-colors hover:bg-status-closed/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-closed/60"
                        >
                          {submitting ? t.reopening : t.btnPerformReopen}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowReopenBox(false)}
                          className="min-h-[44px] px-3.5 text-sm font-medium text-ink-muted hover:text-ink-primary flex items-center"
                        >
                          {t.cancel}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Case 2: Month is OPEN (or REOPENED) — Entry Form */}
          {!isClosed && (
            <form onSubmit={handlePerformClose} className="reconciliation-form bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-3.5">
              {isReopened && closeRecord?.reopenReason && (
                <div className="p-2.5 rounded-lg bg-status-reopened-bg/40 border border-status-reopened/20 text-sm">
                  <span className="font-semibold text-status-reopened block mb-0.5">
                    {t.reopenedStatus} ({closeRecord.reopenedAt?.slice(0, 10)})
                  </span>
                  <span className="text-ink-secondary">{t.reasonLabel}: {closeRecord.reopenReason}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Physical Cash Counted */}
                <div>
                  <label htmlFor="close-cash" className="block text-sm font-semibold text-ink-secondary mb-1.5">
                    {t.cashOnHand}
                  </label>
                  <div className="relative flex items-center">
                    <span data-money-prefix className="absolute left-2.5 text-sm font-bold text-channel-cash select-none">RM</span>
                    <input id="close-cash"
                      disabled={submitting} type="text"
                      inputMode="decimal"
                      value={cashOnHandInput}
                      onChange={(e) => {
                        const sanitized = sanitizeMoneyInput(e.target.value);
                        if (sanitized !== null) {
                          setCashOnHandInput(sanitized);
                          if (errorMessage) setErrorMessage(null);
                        }
                      }}
                      placeholder={t.zeroBalanceShort}
                      className={`money-input w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border ${
                        cashError ? "border-finance-loss" : "border-surface-border"
                      } text-lg font-bold text-ink-primary tabular-nums focus:outline-none focus:bg-white ${
                        cashError
                          ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                          : "focus:border-channel-cash focus-visible:ring-channel-cash/50"
                      } focus-visible:ring-2 transition-colors`}
                    />
                  </div>
                  {cashError && (
                    <div className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
                      <span>{t.invalidAmount}</span>
                    </div>
                  )}
                </div>

                {/* TnG Balance */}
                <div>
                  <label htmlFor="close-tng" className="block text-sm font-semibold text-ink-secondary mb-1.5">
                    {t.tngOnHand}
                  </label>
                  <div className="relative flex items-center">
                    <span data-money-prefix className="absolute left-2.5 text-sm font-bold text-channel-tng select-none">RM</span>
                    <input id="close-tng"
                      disabled={submitting} type="text"
                      inputMode="decimal"
                      value={tngOnHandInput}
                      onChange={(e) => {
                        const sanitized = sanitizeMoneyInput(e.target.value);
                        if (sanitized !== null) {
                          setTngOnHandInput(sanitized);
                          if (errorMessage) setErrorMessage(null);
                        }
                      }}
                      placeholder={t.zeroBalanceShort}
                      className={`money-input w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border ${
                        tngError ? "border-finance-loss" : "border-surface-border"
                      } text-lg font-bold text-ink-primary tabular-nums focus:outline-none focus:bg-white ${
                        tngError
                          ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                          : "focus:border-channel-tng focus-visible:ring-channel-tng/50"
                      } focus-visible:ring-2 transition-colors`}
                    />
                  </div>
                  {tngError && (
                    <div className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
                      <span>{t.invalidAmount}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Reconciliation Preview Bar */}
              <div className="reconciliation-preview p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted font-medium">{t.actualTotal}</span>
                  <span className="font-bold text-ink-primary text-base tabular-nums">
                    {countsComplete && actualCountedSen !== null ? formatMyr(actualCountedSen) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted font-medium">{t.expectedNet}</span>
                  <span className="font-bold text-ink-primary text-base tabular-nums">{formatMyr(expectedNetSen)}</span>
                </div>
                <div className={`reconciliation-result ${!countsComplete ? "is-pending" : hasParseError ? "is-invalid" : isBalanced ? "is-balanced" : "is-mismatch"}`} aria-live="polite">
                  <div className="reconciliation-result-line"><span>{t.reconciliationDiff}</span><strong>{!countsComplete ? "—" : varianceSen !== null ? <>{formatMyr(varianceSen)}{isBalanced && <ActionIcon name="check" size={20} />}</> : "—"}</strong></div>
                  {!countsComplete && <span className="sr-only">{t.awaitingCounts}</span>}
                  {countsComplete && !hasParseError && <span className="sr-only">{isBalanced ? t.reconciliationBalanced : t.reconciliationMismatch}</span>}
                </div>
              </div>

              {/* Note input */}
              <div>
                <label htmlFor="close-note" className="block text-sm font-medium text-ink-secondary mb-1">
                  {t.closeNote}{" "}
                  {!isBalanced && countsComplete && !hasParseError && (
                    <span className="text-finance-loss">{t.noteRequiredBadge}</span>
                  )}
                  {(!countsComplete || isBalanced) && <span className="optional-label">{t.optionalBadge}</span>}
                </label>
                <input
                  id="close-note"
                  disabled={submitting}
                  type="text"
                  value={closeNote}
                  onChange={(e) => {
                    setCloseNote(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder={
                    !isBalanced && countsComplete && !hasParseError
                      ? t.closeNotePlaceholder
                      : undefined
                  }
                  className="note-input w-full h-11 px-3 rounded-lg bg-surface-canvas border border-surface-border text-sm text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                />
              </div>

              {/* If zero sheets in month */}
              {!hasSheetsInMonth && (
                <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    disabled={submitting}
                    checked={confirmEmpty}
                    onChange={(e) => setConfirmEmpty(e.target.checked)}
                    className="w-5 h-5 rounded border-surface-border accent-brand-broccoli cursor-pointer focus:ring-2 focus:ring-brand-broccoli/50"
                    style={{ accentColor: "#15803d" }}
                  />
                  <span>{t.confirmEmptyMonth}</span>
                </label>
              )}

              {!countsComplete && <p className="sr-only">{t.enterBothToClose}</p>}
              {/* Submit Action Button */}
              <button
                type="submit"
                aria-label={submitting ? t.closingMonth : t.btnPerformClose}
                disabled={submitting || !countsComplete}
                className="w-full h-12 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm tracking-wide shadow-xs flex items-center justify-center transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
              >
                {(submitting || countsComplete) && <span className={submitting ? "animate-spin" : undefined}><ActionIcon name={submitting ? "loading" : "lock"} /></span>}<span>{submitting ? t.closingMonth : countsComplete ? t.closeShort : t.fillBothBalancesShort}</span>
              </button>

              {/* Contextual Error Message */}
              {errorMessage && (
                <div className="py-2.5 px-3.5 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between">
                  <span>{errorMessage}</span>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-5 h-5 flex items-center justify-center rounded"
                    aria-label="Close"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </form>
          )}
        </>
      )}
    </div>
  );
}
