"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amountSizeClass, formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError } from "@/lib/i18n";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";
import type { OperatingExpenseType } from "@/services/operating-expense";

export interface OperatingExpenseItem {
  id: number;
  month: string;
  type: OperatingExpenseType;
  amountSen: number;
  note: string | null;
  createdAt: string;
}

interface MonthSummary {
  grossSen: number;
  operatingSen: number;
  netSen: number;
}

export interface MergedExpenseItem {
  key: string;
  type: OperatingExpenseItem["type"];
  note: string | null;
  amountSen: number;
  ids: number[];
}

export function formatDeleteModalRecordCount(
  count: number,
  t?: { removesRecordSingle?: string; removesRecordPlural?: string }
): string {
  if (t?.removesRecordSingle && count === 1) {
    return t.removesRecordSingle;
  }
  if (t?.removesRecordPlural && count > 1) {
    return t.removesRecordPlural.replace("{count}", String(count));
  }
  return count === 1 ? "removes 1 record" : `removes ${count} records`;
}

export function mergeOperatingExpenses(items: OperatingExpenseItem[]): MergedExpenseItem[] {
  const merged: MergedExpenseItem[] = [];
  for (const item of items) {
    const normNote = (item.note || "").trim();
    const existing = merged.find(
      (m) => m.type === item.type && (m.note || "").trim() === normNote,
    );
    if (existing) {
      existing.amountSen += item.amountSen;
      existing.ids.push(item.id);
    } else {
      merged.push({
        key: `${item.type}_${normNote}_${item.id}`,
        type: item.type,
        note: normNote || null,
        amountSen: item.amountSen,
        ids: [item.id],
      });
    }
  }
  return merged;
}

// Draft fields of the add-expense form that the in-flight rebase tracks.
export type ExpenseDraftField = "amount" | "note";

// Rebase helper (local-first draft + authoritative server list). After an add
// succeeds, the list refreshes from the server, but a half-typed draft the
// Operator started while the request was in flight must survive — mom's typing
// wins. Only fields she did NOT touch during the flight were the ones actually
// submitted, so only those get cleared; if she touched anything, the draft card
// stays open with her text intact.
export function resolveExpenseDraftAfterAdd(
  touchedDuringAdd: ReadonlySet<ExpenseDraftField>
): { clearAmount: boolean; clearNote: boolean; closeDraft: boolean } {
  return {
    clearAmount: !touchedDuringAdd.has("amount"),
    clearNote: !touchedDuringAdd.has("note"),
    closeDraft: touchedDuringAdd.size === 0,
  };
}

interface ExpensesViewProps {
  currentMonth: string;
  availableMonths: string[];
  initialExpenses: OperatingExpenseItem[];
  summary?: MonthSummary | null;
  isClosed: boolean;
  userRole?: string;
  monthOptions?: MonthOption[];
  loadError?: string | null;
  initialPendingDeleteExpense?: MergedExpenseItem | null;
  initialAmountError?: boolean;
  initialNoteError?: boolean;
  initialInlineError?: string | null;
  initialIsDraftOpen?: boolean;
  initialNewType?: OperatingExpenseItem["type"];
  initialNoteInput?: string;
}

export function ExpensesView({
  currentMonth,
  availableMonths,
  initialExpenses,
  summary,
  isClosed,
  monthOptions,
  loadError,
  initialPendingDeleteExpense = null,
  initialAmountError = false,
  initialNoteError = false,
  initialInlineError = null,
  initialIsDraftOpen = false,
  initialNewType = "rental",
  initialNoteInput = "",
}: ExpensesViewProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  const [expenses, setExpenses] = useState<OperatingExpenseItem[]>(initialExpenses);

  useEffect(() => {
    setExpenses(initialExpenses);
  }, [initialExpenses]);

  // Merge expense items on frontend if same category and same note
  const mergedExpenses = useMemo(
    () => mergeOperatingExpenses(expenses),
    [expenses],
  );

  // New expense draft form
  const [newType, setNewType] = useState<OperatingExpenseItem["type"]>(initialNewType);
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState(initialNoteInput);
  const [isDraftOpen, setIsDraftOpen] = useState(initialIsDraftOpen);
  const [amountError, setAmountError] = useState(initialAmountError);
  const [noteError, setNoteError] = useState(initialNoteError);
  const noteInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (noteError) {
      noteInputRef.current?.focus();
    }
  }, [noteError]);
  const [adding, setAdding] = useState(false);

  // Draft fields the Operator touched after the add request left the browser.
  // The inputs are disabled while `adding`, but a keystroke can still land in
  // the same tick (queued event, IME commit, paste), so this set — not the
  // disabled attribute — is what guarantees no keystroke is lost. Non-null only
  // while an add is in flight.
  const touchedDuringAddRef = useRef<Set<ExpenseDraftField> | null>(null);

  function markTouchedDuringAdd(field: ExpenseDraftField) {
    touchedDuringAddRef.current?.add(field);
  }
  const [inlineError, setInlineError] = useState<string | null>(initialInlineError);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Confirmation modal state for batch deletion
  const [pendingDeleteExpense, setPendingDeleteExpense] =
    useState<MergedExpenseItem | null>(initialPendingDeleteExpense);

  const categories: Array<{ key: OperatingExpenseItem["type"]; label: string }> = [
    { key: "rental", label: t.catRental },
    { key: "utilities", label: t.catUtilities },
    { key: "wages", label: t.catWages },
    { key: "other", label: t.catOpOther },
  ];

  const getCategoryLabel = (key: string) => {
    const found = categories.find((c) => c.key === key);
    return found ? found.label : key;
  };

  // Close modal on Escape key
  useEffect(() => {
    if (!pendingDeleteExpense) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && deletingKey === null) {
        setPendingDeleteExpense(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingDeleteExpense, deletingKey]);

  // Handle Add Expense
  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (isClosed || adding) return;

    setInlineError(null);
    setSuccessBanner(null);

    let parsedSen: bigint;
    try {
      if (!amountInput.trim()) {
        setAmountError(true);
        return;
      }
      parsedSen = parseSen(amountInput);
      if (parsedSen <= 0n) {
        setAmountError(true);
        return;
      }
      setAmountError(false);
    } catch {
      setAmountError(true);
      return;
    }

    if (newType === "other" && !noteInput.trim()) {
      setNoteError(true);
      requestAnimationFrame(() => noteInputRef.current?.focus());
      return;
    }
    setNoteError(false);

    // Open the touched-fields window for the duration of the flight.
    touchedDuringAddRef.current = new Set<ExpenseDraftField>();
    setAdding(true);

    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          type: newType,
          amountSen: Number(parsedSen),
          note: noteInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(translateApiError(data.error, t));
      }

      setExpenses((prev) => {
        const exists = prev.some((item) => item.id === data.expense.id);
        return exists
          ? prev.map((item) => (item.id === data.expense.id ? data.expense : item))
          : [...prev, data.expense];
      });
      // Only clear what was actually submitted: anything she typed during the
      // flight is a new draft and stays on screen (with the card open).
      const rebase = resolveExpenseDraftAfterAdd(
        touchedDuringAddRef.current ?? new Set<ExpenseDraftField>()
      );
      if (rebase.clearAmount) setAmountInput("");
      if (rebase.clearNote) setNoteInput("");
      setAmountError(false);
      setNoteError(false);
      if (rebase.closeDraft) setIsDraftOpen(false);
      setSuccessBanner(t.addExpenseSuccess);
      setTimeout(() => setSuccessBanner(null), 3000);

      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setInlineError(translateApiError(err.message, t));
    } finally {
      touchedDuringAddRef.current = null;
      setAdding(false);
    }
  }

  // Handle Delete Expense Batch
  async function handleDeleteExpense(key: string, ids: number[]) {
    if (isClosed || deletingKey !== null) return;
    setInlineError(null);
    setSuccessBanner(null);
    setDeletingKey(key);

    const deletedIds: number[] = [];
    try {
      for (const id of ids) {
        const res = await fetch(`/api/expenses?id=${id}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(translateApiError(data.error || "Failed to delete expense", t));
        }
        deletedIds.push(id);
      }

      setSuccessBanner(t.deleteExpenseSuccess);
      setTimeout(() => setSuccessBanner(null), 3000);
    } catch (err: any) {
      setInlineError(translateApiError(err.message, t));
    } finally {
      if (deletedIds.length > 0) {
        setExpenses((prev) => prev.filter((item) => !deletedIds.includes(item.id)));
        startTransition(() => {
          router.refresh();
        });
      }
      setDeletingKey(null);
    }
  }

  const totalExpenseSen = useMemo(() => {
    return expenses.reduce((acc, curr) => acc + BigInt(curr.amountSen), 0n);
  }, [expenses]);

  return (
    <div className="space-y-4">
      {/* Header & Month Selector */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-primary tracking-tight">
          {t.expensesTitle}
        </h1>

        <MonthSelectorDropdown
          currentMonth={currentMonth}
          options={
            monthOptions ??
            availableMonths.map((m) => ({
              month: m,
              status: isClosed ? "closed" : "open",
            }))
          }
          onSelect={(month) => router.push(`/expenses?month=${month}`)}
        />
      </div>

      {loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h3 className="text-sm font-bold text-finance-loss">{t.loadError}</h3>
          </div>
          <p className="text-xs text-ink-secondary">{loadError}</p>
        </div>
      ) : (
        <>
          {/* Read-only banner if closed */}
          {isClosed && (
            <div className="p-3 bg-surface-canvas border border-surface-border rounded-xl text-ink-muted text-xs font-semibold flex items-center gap-2 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
              <span>{t.monthLocked}</span>
            </div>
          )}

          {/* Inline Feedback Alerts */}
          {inlineError && (
            <div className="py-2.5 px-3.5 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between shadow-xs animate-slide-down">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="truncate">{inlineError}</span>
              </div>
              <button
                type="button"
                onClick={() => setInlineError(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-7 h-7 flex items-center justify-center rounded-md shrink-0 cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          )}

          {successBanner && (
            <div className="py-2.5 px-3.5 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/30 text-sm text-brand-broccoli font-bold flex items-center justify-between shadow-xs animate-slide-down">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-brand-broccoli" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="truncate">{successBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setSuccessBanner(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-brand-broccoli w-7 h-7 flex items-center justify-center rounded-md shrink-0 cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          )}

          {/* Month Financial Snapshot Summary Strip (Unified Container matching MonthCloseView) */}
          {summary && (
            <section aria-label="Month Financial Snapshot" className="bg-white border border-surface-border rounded-xl shadow-xs grid grid-cols-2 overflow-hidden">
              <div className="p-3 text-center sm:text-left border-b border-surface-border">
                <div className="text-sm font-medium text-ink-muted mb-0.5">
                  {t.monthGrossProfit}
                </div>
                <div
                  className={`${amountSizeClass(
                    formatMyr(BigInt(summary.grossSen)),
                    "text-xs",
                    "text-base"
                  )} sm:text-xl font-bold text-ink-primary tabular-nums`}
                >
                  {formatMyr(BigInt(summary.grossSen))}
                </div>
              </div>

              <div className="p-3 text-center sm:text-left border-l border-b border-surface-border">
                <div className="text-sm font-medium text-ink-muted mb-0.5">
                  {t.operatingExpenses}
                </div>
                <div
                  className={`${amountSizeClass(
                    formatMyr(totalExpenseSen),
                    "text-xs",
                    "text-base"
                  )} sm:text-xl font-bold text-slate-700 tabular-nums`}
                >
                  {formatMyr(totalExpenseSen)}
                </div>
              </div>

              <div className="col-span-2 p-3.5 sm:px-5 bg-surface-subtle/40 flex items-center justify-between">
                <div className="text-base font-bold text-ink-secondary">
                  {t.netProfit}
                </div>
                <div
                  className={`${amountSizeClass(
                    formatMyr(BigInt(summary.grossSen) - totalExpenseSen),
                    "text-xl",
                    "text-2xl"
                  )} sm:text-3xl font-extrabold tracking-tight tabular-nums ${
                    BigInt(summary.grossSen) - totalExpenseSen >= 0n
                      ? "text-emerald-700"
                      : "text-rose-600"
                  }`}
                >
                  {formatMyr(BigInt(summary.grossSen) - totalExpenseSen)}
                </div>
              </div>
            </section>
          )}

          {/* Operating Expenses Section */}
          <section aria-label="Operating Expenses" className="space-y-2.5">
            <div className="pt-2 pb-0.5" aria-hidden="true">
              <hr className="border-t border-surface-border" />
            </div>
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
                {t.expensesTitle}
              </h2>
              <span className="text-sm font-bold text-slate-700 tabular-nums">
                {formatMyr(totalExpenseSen)}
              </span>
            </div>

            {/* Dynamic Cost Cards */}
            {mergedExpenses.length > 0 && (
              <div className="space-y-2">
                {mergedExpenses.map((item) => (
                  <div
                    key={item.key}
                    className="bg-white border border-surface-border rounded-xl shadow-xs transition-all overflow-hidden hover:border-slate-300"
                  >
                    <div className="w-full px-4 py-3 flex items-center justify-between gap-2 select-none bg-white">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary whitespace-nowrap">
                          {getCategoryLabel(item.type)}
                        </span>
                        {item.ids.length > 1 && (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-surface-subtle text-ink-muted border border-surface-border tabular-nums">
                            ×{item.ids.length}
                          </span>
                        )}
                        {item.note && (
                          <span className="text-sm text-ink-primary font-medium truncate">
                            {item.note}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span
                          className={`${amountSizeClass(
                            formatMyr(BigInt(item.amountSen)),
                            "text-xs",
                            "text-base"
                          )} font-bold text-slate-700 tabular-nums whitespace-nowrap`}
                        >
                          {formatMyr(BigInt(item.amountSen))}
                        </span>

                        {!isClosed && (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteExpense(item)}
                            aria-label={t.delete}
                            title={t.delete}
                            className="w-9 h-9 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state when no expenses recorded */}
            {mergedExpenses.length === 0 && !isDraftOpen && (
              <div className="bg-white border border-surface-border rounded-xl p-6 text-center shadow-xs">
                <div className="text-sm text-ink-muted">
                  {t.noExpensesRecorded}
                </div>
              </div>
            )}

            {/* Active Draft Form Card (Daily-sheet style) */}
            {isDraftOpen && !isClosed && (
              <div className="bg-white border-2 border-brand-broccoli ring-2 ring-brand-broccoli/20 rounded-xl shadow-xs overflow-hidden transition-all">
                <form onSubmit={handleAddExpense} className="p-4 bg-surface-canvas/30 space-y-3">
                  {/* Category Selection */}
                  <div>
                    <span className="block text-xs font-semibold text-ink-secondary mb-2">
                      {t.selectCategory}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((cat) => {
                        const isSelected = newType === cat.key;
                        return (
                          <button
                            key={cat.key}
                            type="button"
                            disabled={adding}
                            onClick={() => {
                              setNewType(cat.key);
                              if (cat.key !== "other" && noteError) setNoteError(false);
                              if (inlineError) setInlineError(null);
                            }}
                            className={`min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-semibold border btn-wave transition-colors select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 disabled:opacity-50 ${
                              isSelected
                                ? "bg-brand-broccoli text-white border-brand-broccoli shadow-xs"
                                : "bg-surface-canvas border-surface-border text-ink-secondary hover:border-ink-muted hover:text-ink-primary"
                            }`}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Amount & Note Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-ink-secondary mb-1">
                        {t.amount} <span className="text-finance-loss">*</span>
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-sm font-bold text-ink-muted select-none">
                          RM
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={adding}
                          value={amountInput}
                          aria-invalid={amountError || undefined}
                          aria-describedby={amountError ? "expense-amount-error" : undefined}
                          onChange={(e) => {
                            const sanitized = sanitizeMoneyInput(e.target.value);
                            if (sanitized !== null) {
                              markTouchedDuringAdd("amount");
                              setAmountInput(sanitized);
                              if (amountError) setAmountError(false);
                              if (inlineError) setInlineError(null);
                            }
                          }}
                          placeholder="0.00"
                          className={`w-full h-11 pl-10 pr-2.5 rounded-lg bg-surface-canvas border ${
                            amountError ? "border-finance-loss" : "border-surface-border"
                          } text-base font-semibold text-ink-primary tabular-nums focus:outline-none focus:bg-white ${
                            amountError
                              ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                              : "focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                          } focus-visible:ring-2 transition-colors`}
                        />
                      </div>
                      {amountError && (
                        <div
                          id="expense-amount-error"
                          role="alert"
                          className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between"
                        >
                          <span>{t.invalidAmount}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ink-secondary mb-1">
                        {t.note} {newType === "other" && <span className="text-finance-loss">*</span>}
                      </label>
                      <input
                        ref={noteInputRef}
                        type="text"
                        disabled={adding}
                        value={noteInput}
                        aria-invalid={noteError || undefined}
                        aria-describedby={noteError ? "expense-note-error" : undefined}
                        onChange={(e) => {
                          markTouchedDuringAdd("note");
                          setNoteInput(e.target.value);
                          if (noteError) setNoteError(false);
                          if (inlineError) setInlineError(null);
                        }}
                        placeholder={newType === "other" ? t.noteRequired : t.noteOptional}
                        className={`w-full h-11 px-3 rounded-lg bg-surface-canvas border ${
                          noteError ? "border-finance-loss" : "border-surface-border"
                        } text-sm text-ink-primary focus:outline-none focus:bg-white ${
                          noteError
                            ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                            : "focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                        } focus-visible:ring-2 transition-colors`}
                      />
                      {noteError && (
                        <div
                          id="expense-note-error"
                          role="alert"
                          className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between"
                        >
                          <span>{t.otherNoteRequired}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons: Cancel and Add */}
                  <div className="flex items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDraftOpen(false);
                        setAmountInput("");
                        setNoteInput("");
                        setAmountError(false);
                        setNoteError(false);
                        if (inlineError) setInlineError(null);
                      }}
                      className="flex-1 h-11 rounded-lg border border-surface-border bg-white hover:bg-surface-subtle text-ink-secondary font-semibold text-sm transition-colors cursor-pointer"
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={adding}
                      className="flex-1 h-11 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {adding ? t.saving : t.addExpense}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Standalone Clickable "+ Add Cost" Button at bottom */}
            {!isClosed && !isDraftOpen && (
              <button
                type="button"
                onClick={() => setIsDraftOpen(true)}
                className="relative w-full min-h-[60px] py-3 px-4 rounded-xl bg-emerald-50/40 hover:bg-emerald-50/80 flex items-center justify-center gap-2 text-sm font-bold text-brand-broccoli transition-all shadow-xs select-none active:scale-[0.99] cursor-pointer group overflow-hidden"
              >
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none rounded-xl"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    x="1"
                    y="1"
                    width="calc(100% - 2px)"
                    height="calc(100% - 2px)"
                    rx="11"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="8 5"
                    className="text-emerald-400/90 group-hover:text-brand-broccoli transition-colors"
                  />
                </svg>
                <span className="text-lg leading-none relative z-10">+</span>
                <span className="relative z-10">{t.addExpense}</span>
              </button>
            )}
          </section>

          {/* Delete Item Confirmation Dialog */}
          {pendingDeleteExpense && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-delete-expense-title"
              aria-describedby="confirm-delete-expense-desc"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
              onClick={(e) => {
                if (e.target === e.currentTarget && deletingKey === null) {
                  setPendingDeleteExpense(null);
                }
              }}
            >
              <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-surface-border space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-finance-loss-light border border-finance-loss-border/60 text-finance-loss flex items-center justify-center shrink-0 select-none">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 id="confirm-delete-expense-title" className="text-base font-bold text-ink-primary">
                      {t.confirmDeleteItemTitle}
                    </h3>
                    <p id="confirm-delete-expense-desc" className="text-xs text-ink-muted mt-0.5">
                      {formatDeleteModalRecordCount(pendingDeleteExpense.ids.length, t)} · {t.confirmDeleteItemDesc}
                    </p>
                  </div>
                </div>

                {/* Item detail snapshot */}
                <div className="p-3 rounded-xl bg-surface-subtle border border-surface-border flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-surface-border text-ink-secondary whitespace-nowrap">
                      {getCategoryLabel(pendingDeleteExpense.type)}
                    </span>
                    {pendingDeleteExpense.note && (
                      <span className="text-xs text-ink-muted truncate">
                        {pendingDeleteExpense.note}
                      </span>
                    )}
                  </div>
                  <span
                    className={`${amountSizeClass(
                      formatMyr(BigInt(pendingDeleteExpense.amountSen)),
                      "text-xs",
                      "text-base"
                    )} font-bold text-finance-loss whitespace-nowrap tabular-nums`}
                  >
                    {formatMyr(BigInt(pendingDeleteExpense.amountSen))}
                  </span>
                </div>

                {/* Modal Actions */}
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={() => setPendingDeleteExpense(null)}
                    className="flex-1 h-11 rounded-lg border border-surface-border bg-white hover:bg-surface-subtle text-ink-secondary font-semibold text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-surface-border disabled:opacity-50"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={async () => {
                      await handleDeleteExpense(pendingDeleteExpense.key, pendingDeleteExpense.ids);
                      setPendingDeleteExpense(null);
                    }}
                    className="flex-1 h-11 rounded-lg bg-finance-loss hover:bg-finance-loss/90 btn-wave text-white font-bold text-sm transition-colors shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {deletingKey !== null ? t.saving : t.confirmDeleteBtn}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
