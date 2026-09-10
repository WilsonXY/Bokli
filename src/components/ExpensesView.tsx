"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
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

export function formatDeleteModalRecordCount(count: number): string {
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
  const [newType, setNewType] = useState<OperatingExpenseItem["type"]>("rental");
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  // UI status
  const [adding, setAdding] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<MergedExpenseItem | null>(
    initialPendingDeleteExpense,
  );

  // Close delete item confirmation modal on Escape key
  useEffect(() => {
    if (!pendingDeleteExpense) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && deletingKey === null) {
        setPendingDeleteExpense(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingDeleteExpense, deletingKey]);

  const [inlineError, setInlineError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const categories: Array<{
    key: OperatingExpenseItem["type"];
    label: string;
  }> = [
    { key: "rental", label: t.catRental },
    { key: "utilities", label: t.catUtilities },
    { key: "wages", label: t.catWages },
    { key: "other", label: t.catOpOther },
  ];

  const getCategoryLabel = (type: OperatingExpenseItem["type"]) => {
    const found = categories.find((c) => c.key === type);
    return found ? found.label : type;
  };

  // Safe parsing helper: returns null for unparseable non-empty inputs
  function toSen(val: string): bigint | null {
    const s = val.trim();
    if (!s) return 0n;
    try {
      return parseSen(s);
    } catch {
      return null;
    }
  }

  const amountSen = toSen(amountInput);
  const amountError = amountInput.trim() !== "" && amountSen === null;

  // Handle Add Expense
  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (adding) return;
    if (isClosed) return;
    setInlineError(null);

    const amountVal = toSen(amountInput);
    if (amountVal === null || amountVal <= 0n) {
      setInlineError(t.invalidAmount);
      return;
    }

    if (newType === "other" && !noteInput.trim()) {
      setInlineError(t.otherNoteRequired);
      return;
    }

    setAdding(true);

    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: currentMonth,
          type: newType,
          amountSen: Number(amountVal),
          note: noteInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(translateApiError(data.error, t));
      }

      setExpenses((prev) => {
        const exists = prev.some((item) => item.id === data.expense.id);
        if (exists) {
          return prev.map((item) => (item.id === data.expense.id ? data.expense : item));
        }
        return [...prev, data.expense];
      });
      setAmountInput("");
      setNoteInput("");
      setSuccessBanner(t.addExpenseSuccess);
      setTimeout(() => setSuccessBanner(null), 3000);

      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setInlineError(translateApiError(err.message, t));
    } finally {
      setAdding(false);
    }
  }

  // Handle Delete Expense
  async function handleDeleteExpense(key: string, ids: number[]) {
    if (isClosed || deletingKey !== null) return;
    setDeletingKey(key);
    setInlineError(null);

    const deletedIds: number[] = [];
    let deleteError: Error | null = null;

    try {
      for (const id of ids) {
        try {
          const res = await fetch(`/api/expenses?id=${id}`, {
            method: "DELETE",
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ? translateApiError(data.error, t) : "Failed to delete expense");
          }

          deletedIds.push(id);
        } catch (err: any) {
          deleteError = err instanceof Error ? err : new Error(String(err));
          break;
        }
      }

      // Consistent state update: even if loop failed halfway, remove IDs deleted so far
      if (deletedIds.length > 0) {
        setExpenses((prev) => prev.filter((item) => !deletedIds.includes(item.id)));
        startTransition(() => {
          router.refresh();
        });
      }

      // Surface errors via inline error UI rather than alert()
      if (deleteError) {
        setInlineError(translateApiError(deleteError.message, t));
      } else {
        setSuccessBanner(t.deleteExpenseSuccess || "Expense deleted");
        setTimeout(() => setSuccessBanner(null), 3000);
      }
    } finally {
      setDeletingKey(null);
    }
  }

  const totalExpenseSen = useMemo(() => {
    return expenses.reduce((acc, curr) => acc + BigInt(curr.amountSen), 0n);
  }, [expenses]);

  return (
    <div className="space-y-4">
      {/* Month Selector Strip */}
      <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs flex items-center justify-between">
        <span className="text-base font-bold text-ink-primary whitespace-nowrap">
          {t.expensesTitle}
        </span>

        {/* Month Dropdown */}
        <MonthSelectorDropdown
          currentMonth={currentMonth}
          options={
            monthOptions ||
            availableMonths.map((m) => ({
              month: m,
              status: m === currentMonth && isClosed ? "closed" : "open",
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
          {/* Lock Notice */}
          {isClosed && (
            <div className="py-2 px-3 rounded-lg bg-status-closed-bg/60 border border-status-closed/20 flex items-center gap-2 text-sm font-medium text-status-closed">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>{t.monthLocked}</span>
            </div>
          )}

          {/* Success Banner */}
          {successBanner && (
            <div className="py-2 px-3 rounded-lg bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{successBanner}</span>
            </div>
          )}

          {/* Inline Error Banner */}
          {inlineError && (
            <div
              role="alert"
              aria-live="assertive"
              className="py-2 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between shadow-xs animate-slide-down"
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="truncate">{inlineError}</span>
              </div>
              <button
                type="button"
                onClick={() => setInlineError(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-6 h-6 flex items-center justify-center rounded shrink-0 cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          )}

          {/* Month Financial Impact Strip */}
          {summary && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white border border-surface-border rounded-xl p-2.5 text-center shadow-xs">
                <div className="text-[13px] font-medium text-ink-muted mb-0.5">
                  {t.grossProfit}
                </div>
                <div className="text-base font-bold text-ink-primary">
                  {formatMyr(BigInt(summary.grossSen))}
                </div>
              </div>

              <div className="bg-white border border-surface-border rounded-xl p-2.5 text-center shadow-xs">
                <div className="text-[13px] font-medium text-ink-muted mb-0.5">
                  {t.operatingExpenses}
                </div>
                <div className="text-base font-bold text-finance-loss">
                  {formatMyr(totalExpenseSen)}
                </div>
              </div>

              <div className="bg-white border border-surface-border rounded-xl p-2.5 text-center shadow-xs">
                <div className="text-[13px] font-medium text-ink-muted mb-0.5">
                  {t.netProfit}
                </div>
                <div
                  className={`text-base font-bold ${
                    BigInt(summary.grossSen) - totalExpenseSen >= 0n
                      ? "text-brand-broccoli"
                      : "text-finance-loss"
                  }`}
                >
                  {formatMyr(BigInt(summary.grossSen) - totalExpenseSen)}
                </div>
              </div>
            </div>
          )}

          {/* Add Operating Expense Form */}
          {!isClosed && (
            <section aria-label="Add Operating Expense" className="bg-white border border-surface-border rounded-xl p-3 shadow-xs space-y-2.5">
              <div>
                <span className="block text-sm font-medium text-ink-muted mb-1.5">
                  {t.selectCategory}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => {
                    const isSelected = newType === cat.key;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => {
                          setNewType(cat.key);
                          if (inlineError) setInlineError(null);
                        }}
                        className={`min-h-[44px] px-3.5 py-2.5 rounded-lg text-sm font-semibold border btn-wave transition-colors select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 ${
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

              <form onSubmit={handleAddExpense} className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[13px] font-semibold text-ink-secondary mb-1">
                      {t.amount} <span className="text-finance-loss">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-sm font-bold text-ink-muted select-none">
                        RM
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amountInput}
                        onChange={(e) => {
                          const sanitized = sanitizeMoneyInput(e.target.value);
                          if (sanitized !== null) {
                            setAmountInput(sanitized);
                            if (inlineError) setInlineError(null);
                          }
                        }}
                        placeholder="0.00"
                        className={`w-full h-11 pl-9 pr-2.5 rounded-lg bg-surface-canvas border ${
                          amountError ? "border-finance-loss" : "border-surface-border"
                        } text-base font-semibold text-ink-primary focus:outline-none focus:bg-white ${
                          amountError
                            ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                            : "focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                        } focus-visible:ring-2 transition-colors`}
                      />
                    </div>
                    {amountError && (
                      <div className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
                        <span>{t.invalidAmount}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-ink-secondary mb-1">
                      {t.note} {newType === "other" && <span className="text-finance-loss">*</span>}
                    </label>
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => {
                        setNoteInput(e.target.value);
                        if (inlineError) setInlineError(null);
                      }}
                      placeholder={newType === "other" ? t.noteRequired : t.noteOptional}
                      className="w-full h-11 px-2.5 rounded-lg bg-surface-canvas border border-surface-border text-sm text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={adding}
                  className="w-full h-11 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm shadow-xs flex items-center justify-center transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
                >
                  {adding ? t.saving : t.addExpense}
                </button>
              </form>
            </section>
          )}

          {/* Operating Expenses List */}
          <section aria-label="Operating Expenses List" className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-bold text-ink-secondary uppercase tracking-wider">
                {t.expensesTitle}
              </span>
              <span className="text-xs font-semibold text-ink-muted">
                {mergedExpenses.length} {t.expenseTotal}
              </span>
            </div>

            <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs">
              {mergedExpenses.length === 0 ? (
                <div className="text-center py-6 text-sm text-ink-muted">
                  {t.noExpensesRecorded}
                </div>
              ) : (
                <ul className="divide-y divide-surface-border">
                  {mergedExpenses.map((item) => (
                    <li
                      key={item.key}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary">
                            {getCategoryLabel(item.type)}
                          </span>
                          {item.ids.length > 1 && (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-surface-subtle text-ink-muted border border-surface-border">
                              ×{item.ids.length}
                            </span>
                          )}
                          {item.note && (
                            <span className="text-sm text-ink-primary font-medium truncate">
                              {item.note}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-base font-bold text-finance-loss">
                          {formatMyr(BigInt(item.amountSen))}
                        </span>

                        {!isClosed && (
                          <button
                            type="button"
                            disabled={deletingKey === item.key}
                            onClick={() => setPendingDeleteExpense(item)}
                            className="w-8 h-8 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer disabled:opacity-50"
                            title={t.delete}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Delete Item Confirmation Dialog */}
          {pendingDeleteExpense && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-delete-expense-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-primary/40 backdrop-blur-xs animate-fade-in"
              onClick={() => {
                if (deletingKey === null) setPendingDeleteExpense(null);
              }}
            >
              <div
                className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-surface-border space-y-4 animate-scale-in"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-finance-loss-light border border-finance-loss-border/60 text-finance-loss flex items-center justify-center shrink-0 select-none">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h3 id="confirm-delete-expense-title" className="text-base font-bold text-ink-primary leading-tight">
                      {t.confirmDeleteItemTitle}
                    </h3>
                    <p id="confirm-delete-expense-desc" className="text-xs text-ink-muted mt-0.5">
                      <span className="font-semibold text-finance-loss">
                        {formatDeleteModalRecordCount(pendingDeleteExpense.ids.length)}
                      </span>
                      {" — "}
                      {t.confirmDeleteItemDesc}
                    </p>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-surface-subtle border border-surface-border text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-ink-muted font-medium">{t.selectCategory}:</span>
                    <span className="font-semibold text-ink-primary">
                      {getCategoryLabel(pendingDeleteExpense.type)}
                    </span>
                  </div>
                  <div className="flex justify-between" data-testid="modal-record-count">
                    <span className="text-ink-muted font-medium">
                      Records:
                    </span>
                    <span className="font-semibold text-ink-primary">
                      {formatDeleteModalRecordCount(pendingDeleteExpense.ids.length)}
                    </span>
                  </div>
                  {pendingDeleteExpense.note && (
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-muted font-medium shrink-0">{t.note}:</span>
                      <span className="text-ink-primary truncate font-medium">
                        {pendingDeleteExpense.note}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 border-t border-surface-border">
                    <span className="text-ink-muted font-medium">{t.amount}:</span>
                    <span className="font-bold text-finance-loss">
                      {formatMyr(BigInt(pendingDeleteExpense.amountSen))}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={() => setPendingDeleteExpense(null)}
                    className="min-h-[44px] px-4 rounded-lg border border-surface-border hover:bg-surface-subtle text-sm font-semibold text-ink-secondary transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={async () => {
                      const target = pendingDeleteExpense;
                      await handleDeleteExpense(target.key, target.ids);
                      setPendingDeleteExpense(null);
                    }}
                    className="min-h-[44px] px-4 rounded-lg bg-finance-loss hover:bg-finance-loss-dark text-white font-semibold text-sm transition-colors cursor-pointer shadow-xs disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 flex items-center gap-1.5"
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
