"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sanitizeMoneyInput, tryParseSen } from "@/lib/money";
import { apiFetch } from "@/lib/cloud-client";
import { useI18n, translateApiError, apiErrorPayloadFrom, type TranslationMap } from "@/lib/i18n";
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
  const { t, lang } = useI18n();
  const [, startTransition] = useTransition();

  const [cashOnHandInput, setCashOnHandInput] = useState(initialCashOnHandInput);
  const [tngOnHandInput, setTngOnHandInput] = useState(initialTngOnHandInput);
  const [closeNote, setCloseNote] = useState(initialCloseNote);
  const [confirmEmpty, setConfirmEmpty] = useState(initialConfirmEmpty);

  const [showReopenBox, setShowReopenBox] = useState(false);
  const [reopenReasonInput, setReopenReasonInput] = useState("");

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
  const hasCashInput = cashOnHandInput.trim() !== "";
  const hasTngInput = tngOnHandInput.trim() !== "";
  const hasInputs = hasCashInput || hasTngInput;
  const hasPartialInput = hasCashInput !== hasTngInput;
  const isAwaitingCount = !hasInputs && !hasParseError;
  const canSubmitClose = !submitting && !isAwaitingCount && gating.canClose;
  const closeReadinessHint = isAwaitingCount
    ? t.closeReadyAwaitingHint
    : !hasSheetsInMonth && !confirmEmpty
    ? t.emptyMonthError
    : null;

  const isClosed = Boolean(closeRecord?.isClosed);
  const isReopened = Boolean(closeRecord?.isReopened);

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
        startTransition(() => {
          refresh();
        });
      },
    });
  }

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
    <div className="space-y-6">
      {/* Header & Month Selector — Stacks cleanly on narrow mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-primary tracking-tight">
          {t.closeTitle}
        </h1>

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
            <div className="py-2.5 px-4 rounded-xl bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center gap-2 shadow-card animate-slide-down">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{successMessage}</span>
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
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full num-tabular whitespace-nowrap shrink-0 ${
                        expectedNetSen >= 0n
                          ? "bg-finance-profit-light text-finance-profit border border-finance-profit-border"
                          : "bg-finance-loss-light text-finance-loss border border-finance-loss-border"
                      }`}
                    >
                      {t.profitMargin} {Math.round((financials.netSen / financials.revenueSen) * 1000) / 10}%
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
                    <span className="font-semibold text-ink-secondary num-tabular">
                      {financials.dailyCostSen > 0 ? "\u2212" : ""}
                      <MoneyValue sen={BigInt(financials.dailyCostSen)} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-dashed border-surface-border">
                    <span className="text-ink-primary font-semibold">{t.monthGrossProfit}</span>
                    <MoneyValue
                      sen={BigInt(financials.grossSen)}
                      className="font-bold text-ink-primary"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-muted">{t.operatingExpenses}</span>
                    <span className="font-semibold text-ink-secondary num-tabular">
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
                    <div className="flex items-center gap-2.5 text-status-closed font-bold text-sm">
                      <span className="w-8 h-8 rounded-xl bg-status-closed-bg flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </span>
                      <span>{t.monthLocked}</span>
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
                      <span className="text-ink-primary">{closeRecord.note}</span>
                    </div>
                  )}

                  {closeRecord?.closedAt && (
                    <div className="text-xs text-ink-muted num-tabular">
                      {t.closedAtLabel}: {closeRecord.closedAt}
                    </div>
                  )}

                  {/* Admin Reopen Section */}
                  {userRole === "Admin" && (
                    <div className="pt-4 border-t border-surface-border">
                      {!showReopenBox ? (
                        <button
                          type="button"
                          onClick={() => setShowReopenBox(true)}
                          className="min-h-[48px] px-4 rounded-xl border border-surface-border-strong hover:bg-surface-subtle btn-tactile text-sm font-semibold text-ink-secondary hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                        >
                          {t.reopenTitle}
                        </button>
                      ) : (
                        <form onSubmit={handlePerformReopen} className="space-y-3 bg-surface-subtle/60 p-4 rounded-xl border border-surface-border">
                          <label htmlFor="reopen-reason-input" className="block text-sm font-semibold text-ink-primary">
                            {t.reopenReason} <span className="text-finance-loss">*</span>
                          </label>
                          <input
                            id="reopen-reason-input"
                            type="text"
                            value={reopenReasonInput}
                            onChange={(e) => setReopenReasonInput(e.target.value)}
                            placeholder={t.reopenPlaceholder}
                            className="w-full h-12 px-3.5 rounded-xl bg-surface-input border border-surface-border-strong text-sm text-ink-primary focus:outline-none focus:bg-surface focus:border-brand-broccoli focus-visible:ring-2 focus-visible:ring-brand-broccoli/40"
                          />
                          <div className="flex items-center gap-2.5">
                            <button
                              type="submit"
                              disabled={submitting}
                              className="min-h-[48px] px-5 rounded-xl bg-brand-cta hover:bg-brand-cta-hover text-brand-cta-ink btn-tactile font-semibold text-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                            >
                              {submitting ? t.reopening : t.btnPerformReopen}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowReopenBox(false)}
                              className="min-h-[48px] px-4 text-sm font-semibold text-ink-muted hover:text-ink-primary cursor-pointer"
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

                    {isReopened && closeRecord?.reopenReason && (
                      <div className="p-3.5 rounded-xl bg-status-reopened-bg border border-status-reopened/20 text-sm">
                        <span className="font-semibold text-status-reopened block mb-0.5">
                          {t.reopenedStatus} ({closeRecord.reopenedAt?.slice(0, 10)})
                        </span>
                        <span className="text-ink-secondary">
                          {t.reasonLabel}: {closeRecord.reopenReason}
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
                            id="close-cash-input"
                            type="text"
                            inputMode="decimal"
                            value={cashOnHandInput}
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
                            } focus-visible:ring-2 transition-colors`}
                          />
                        </div>
                        {cashError && (
                          <div role="alert" className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium">
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
                            value={tngOnHandInput}
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
                            } focus-visible:ring-2 transition-colors`}
                          />
                        </div>
                        {tngError && (
                          <div role="alert" className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium">
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
                        value={closeNote}
                        onChange={(e) => {
                          setCloseNote(e.target.value);
                          if (errorMessage) setErrorMessage(null);
                        }}
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
                        className="w-full h-12 px-3.5 rounded-xl bg-surface-input border border-surface-border-strong text-sm text-ink-primary focus:outline-none focus:bg-surface focus:border-brand-broccoli focus-visible:ring-2 focus-visible:ring-brand-broccoli/30 transition-colors"
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
                      <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary cursor-pointer select-none py-1">
                        <input
                          type="checkbox"
                          checked={confirmEmpty}
                          onChange={(e) => setConfirmEmpty(e.target.checked)}
                          className="w-5 h-5 rounded border-surface-border-strong accent-brand-broccoli cursor-pointer focus:ring-2 focus:ring-brand-broccoli/50"
                        />
                        <span>{t.confirmEmptyMonth}</span>
                      </label>
                    )}
                  </div>

                  {/* Action Footer: Close Month aligns strictly with Reconciliation readiness */}
                  <div className="space-y-2.5 pt-2">
                    <button
                      type="submit"
                      disabled={!canSubmitClose}
                      className="w-full h-12 rounded-xl bg-brand-cta hover:bg-brand-cta-hover btn-tactile text-brand-cta-ink font-semibold text-sm tracking-wide shadow-card flex items-center justify-center disabled:bg-surface-subtle disabled:text-ink-muted disabled:border disabled:border-surface-border disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
                    >
                      {submitting ? t.closingMonth : t.btnPerformClose}
                    </button>

                    <p className="text-xs text-ink-muted text-center">
                      {closeReadinessHint ?? t.closeWarning}
                    </p>

                    {errorMessage && (
                      <div role="alert" className="py-2.5 px-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between">
                        <span>{errorMessage}</span>
                        <button
                          type="button"
                          onClick={() => setErrorMessage(null)}
                          className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          aria-label={t.closeLabel}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
