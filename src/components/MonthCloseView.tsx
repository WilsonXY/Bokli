"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError } from "@/lib/i18n";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";

interface FinancialSnapshot {
  revenueSen: number;
  dailyCostSen: number;
  grossSen: number;
  operatingSen: number;
  netSen: number;
}

interface CloseRecordData {
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

interface MonthCloseViewProps {
  currentMonth: string;
  availableMonths: string[];
  financials: FinancialSnapshot;
  closeRecord: CloseRecordData | null;
  userRole?: string;
  hasSheetsInMonth: boolean;
  monthOptions?: MonthOption[];
}

export function MonthCloseView({
  currentMonth,
  availableMonths,
  financials,
  closeRecord,
  userRole,
  hasSheetsInMonth,
  monthOptions,
}: MonthCloseViewProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  // Input state for reconciliation
  const [cashOnHandInput, setCashOnHandInput] = useState("");
  const [tngOnHandInput, setTngOnHandInput] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // Admin reopen state
  const [showReopenBox, setShowReopenBox] = useState(false);
  const [reopenReasonInput, setReopenReasonInput] = useState("");

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Safe parsing helper
  function toSen(val: string): bigint {
    const s = val.trim();
    if (!s) return 0n;
    try {
      return parseSen(s);
    } catch {
      return 0n;
    }
  }

  const expectedNetSen = BigInt(financials.netSen);
  const cashOnHandSen = toSen(cashOnHandInput);
  const tngOnHandSen = toSen(tngOnHandInput);
  const actualCountedSen = cashOnHandSen + tngOnHandSen;
  const varianceSen = actualCountedSen - expectedNetSen;
  const isBalanced = varianceSen === 0n;
  const hasInputs = cashOnHandInput.trim() !== "" || tngOnHandInput.trim() !== "";

  const isClosed = Boolean(closeRecord?.isClosed);
  const isReopened = Boolean(closeRecord?.isReopened);

  // Handle Month Close submission
  async function handlePerformClose(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!hasSheetsInMonth && !confirmEmpty) {
      setErrorMessage(t.emptyMonthError);
      return;
    }

    if (!isBalanced && !closeNote.trim()) {
      setErrorMessage(t.varianceNoteRequired);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/close", {
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
        throw new Error(translateApiError(data.error, t));
      }

      setSuccessMessage(t.closeSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);

      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setErrorMessage(translateApiError(err.message, t));
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Admin Reopen
  async function handlePerformReopen(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!reopenReasonInput.trim()) {
      setErrorMessage(t.reopenReasonRequired);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/close/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          reason: reopenReasonInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(translateApiError(data.error, t));
      }

      setShowReopenBox(false);
      setReopenReasonInput("");
      setSuccessMessage(t.reopenSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);

      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setErrorMessage(translateApiError(err.message, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Month Selector Strip */}
      <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs flex items-center justify-between">
        <span className="text-base font-bold text-ink-primary whitespace-nowrap">
          {t.closeTitle}
        </span>

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

      {/* Success Notification */}
      {successMessage && (
        <div className="py-2 px-3 rounded-lg bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Financial Snapshot Summary Strip */}
      <section aria-label="Month Financial Snapshot" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white border border-surface-border rounded-xl p-2.5 shadow-xs">
          <div className="text-[13px] font-medium text-ink-muted mb-0.5">
            {t.totalRevenue}
          </div>
          <div className="text-base font-bold text-ink-primary">
            {formatMyr(BigInt(financials.revenueSen))}
          </div>
        </div>

        <div className="bg-white border border-surface-border rounded-xl p-2.5 shadow-xs">
          <div className="text-[13px] font-medium text-ink-muted mb-0.5">
            {t.costsTitle}
          </div>
          <div className="text-base font-bold text-finance-loss">
            {formatMyr(BigInt(financials.dailyCostSen))}
          </div>
        </div>

        <div className="bg-white border border-surface-border rounded-xl p-2.5 shadow-xs">
          <div className="text-[13px] font-medium text-ink-muted mb-0.5">
            {t.operatingExpenses}
          </div>
          <div className="text-base font-bold text-finance-loss">
            {formatMyr(BigInt(financials.operatingSen))}
          </div>
        </div>

        <div className="bg-white border border-surface-border rounded-xl p-2.5 shadow-xs">
          <div className="text-[13px] font-medium text-ink-muted mb-0.5">
            {t.expectedNet}
          </div>
          <div
            className={`text-base font-bold ${
              expectedNetSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
            }`}
          >
            {formatMyr(expectedNetSen)}
          </div>
        </div>
      </section>

      {/* Case 1: Month is CLOSED */}
      {isClosed && (
        <section aria-label="Closed Month Reconciliation Audit" className="bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-3.5">
          <div className="flex items-center gap-2 text-status-closed font-semibold text-sm border-b border-surface-border pb-2.5">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>{t.monthLocked}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-ink-muted block text-[13px] mb-0.5 font-medium">{t.cashOnHand}</span>
              <span className="font-bold text-ink-primary text-base">
                {formatMyr(BigInt(closeRecord?.cashOnHandSen ?? 0))}
              </span>
            </div>
            <div>
              <span className="text-ink-muted block text-[13px] mb-0.5 font-medium">{t.tngOnHand}</span>
              <span className="font-bold text-ink-primary text-base">
                {formatMyr(BigInt(closeRecord?.tngOnHandSen ?? 0))}
              </span>
            </div>
            <div>
              <span className="text-ink-muted block text-[13px] mb-0.5 font-medium">{t.actualTotal}</span>
              <span className="font-bold text-ink-primary text-base">
                {formatMyr(BigInt(closeRecord?.actualSen ?? 0))}
              </span>
            </div>
            <div>
              <span className="text-ink-muted block text-[13px] mb-0.5 font-medium">{t.reconciliationDiff}</span>
              <span
                className={`font-bold text-base ${
                  closeRecord?.balanced ? "text-brand-broccoli" : "text-finance-loss"
                }`}
              >
                {closeRecord?.balanced ? t.reconciliationBalanced : formatMyr(BigInt(closeRecord?.differenceSen ?? 0))}
              </span>
            </div>
          </div>

          {closeRecord?.note && (
            <div className="text-sm bg-surface-subtle p-2.5 rounded-lg border border-surface-border">
              <span className="font-semibold text-ink-secondary block mb-0.5">{t.closeNote}:</span>
              <span className="text-ink-primary">{closeRecord.note}</span>
            </div>
          )}

          {closeRecord?.closedAt && (
            <div className="text-[13px] text-ink-muted">
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
                  <label className="block text-sm font-semibold text-ink-primary">
                    {t.reopenReason} <span className="text-finance-loss">*</span>
                  </label>
                  <input
                    type="text"
                    value={reopenReasonInput}
                    onChange={(e) => setReopenReasonInput(e.target.value)}
                    placeholder={t.reopenPlaceholder}
                    className="w-full h-11 px-2.5 rounded-lg bg-white border border-surface-border text-sm text-ink-primary focus:outline-none focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
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
        <form onSubmit={handlePerformClose} className="bg-white border border-surface-border rounded-xl p-3.5 shadow-xs space-y-3.5">
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
              <label className="block text-sm font-semibold text-ink-primary mb-1">
                {t.cashOnHand}
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-sm font-bold text-channel-cash select-none">
                  RM
                </span>
                <input
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
                  className="w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-lg font-bold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-cash focus-visible:ring-2 focus-visible:ring-channel-cash/50 transition-colors"
                />
              </div>
            </div>

            {/* TnG Balance */}
            <div>
              <label className="block text-sm font-semibold text-ink-primary mb-1">
                {t.tngOnHand}
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-sm font-bold text-channel-tng select-none">
                  RM
                </span>
                <input
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
                  className="w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-lg font-bold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-tng focus-visible:ring-2 focus-visible:ring-channel-tng/50 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Live Reconciliation Preview Bar */}
          <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted font-medium">{t.actualTotal}:</span>
              <span className="font-bold text-ink-primary text-base">{formatMyr(actualCountedSen)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted font-medium">{t.expectedNet}:</span>
              <span className="font-bold text-ink-primary text-base">{formatMyr(expectedNetSen)}</span>
            </div>
            <div className="pt-2 border-t border-surface-border flex items-center justify-between text-sm">
              <span className="font-semibold text-ink-secondary">{t.reconciliationDiff}:</span>
              <div className="flex items-center gap-1.5">
                {hasInputs && (
                  <span
                    className={`text-[13px] px-2 py-0.5 rounded font-semibold ${
                      isBalanced
                        ? "bg-finance-profit-light text-brand-broccoli"
                        : "bg-finance-loss-light text-finance-loss"
                    }`}
                  >
                    {isBalanced ? t.reconciliationBalanced : t.reconciliationMismatch}
                  </span>
                )}
                <span
                  className={`font-bold text-base ${
                    isBalanced ? "text-brand-broccoli" : "text-finance-loss"
                  }`}
                >
                  {formatMyr(varianceSen)}
                </span>
              </div>
            </div>
          </div>

          {/* Note input */}
          <div>
            <label className="block text-sm font-semibold text-ink-primary mb-1">
              {t.closeNote} {!isBalanced && hasInputs && <span className="text-finance-loss">({t.noteRequiredBadge})</span>}
            </label>
            <input
              type="text"
              value={closeNote}
              onChange={(e) => {
                setCloseNote(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder={!isBalanced && hasInputs ? t.closeNotePlaceholder : t.closeNoteOptional}
              className="w-full h-11 px-2.5 rounded-lg bg-surface-canvas border border-surface-border text-sm text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
            />
          </div>

          {/* If zero sheets in month */}
          {!hasSheetsInMonth && (
            <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={confirmEmpty}
                onChange={(e) => setConfirmEmpty(e.target.checked)}
                className="w-5 h-5 rounded border-surface-border accent-brand-broccoli cursor-pointer focus:ring-2 focus:ring-brand-broccoli/50"
                style={{ accentColor: "#15803d" }}
              />
              <span>{t.confirmEmptyMonth}</span>
            </label>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm tracking-wide shadow-xs flex items-center justify-center transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            {submitting ? t.closingMonth : t.btnPerformClose}
          </button>

          {/* Contextual Error Message */}
          {errorMessage && (
            <div className="py-2 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss"
              >
                ✕
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
