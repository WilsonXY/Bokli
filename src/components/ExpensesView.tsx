"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError } from "@/lib/i18n";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";

export interface OperatingExpenseItem {
  id: number;
  month: string;
  type: "rental" | "utilities" | "wages" | "other";
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

function mergeOperatingExpenses(items: OperatingExpenseItem[]): MergedExpenseItem[] {
  const merged: MergedExpenseItem[] = [];
  for (const item of items) {
    const normNote = (item.note || "").trim();
    const existing = merged.find(
      (m) => m.type === item.type && (m.note || "").trim() === normNote
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
  summary: MonthSummary;
  isClosed: boolean;
  userRole?: string;
  monthOptions?: MonthOption[];
}

export function ExpensesView({
  currentMonth,
  availableMonths,
  initialExpenses,
  summary,
  isClosed,
  monthOptions,
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
    [expenses]
  );

  // New expense draft form
  const [newType, setNewType] = useState<OperatingExpenseItem["type"]>("rental");
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  // UI status
  const [adding, setAdding] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<MergedExpenseItem | null>(null);

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

  const getCategoryLabel = (type: string) => {
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

    try {
      for (const id of ids) {
        const res = await fetch(`/api/expenses?id=${id}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(translateApiError(data.error, t));
        }
      }

      setExpenses((prev) => prev.filter((item) => !ids.includes(item.id)));
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      alert(translateApiError(err.message, t));
    } finally {
      setDeletingKey(null);
    }
  }

  const totalExpenseSen = expenses.reduce(
    (acc, item) => acc + BigInt(item.amountSen),
    0n,
  );

  return (
    <div className="space-y-4">
      {/* Month Selector Strip */}
      <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs flex items-center justify-between">
        <span className="text-base font-bold text-ink-primary">
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

      {/* Month Financial Impact Strip */}
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
                        ? "bg-brand-broccoli text-white border-brand-broccoli shadow-xs hover:bg-brand-broccoli-dark"
                        : "bg-surface-subtle text-ink-secondary border-surface-border hover:border-brand-broccoli hover:text-brand-broccoli hover:bg-brand-broccoli-light/30"
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">
                {t.amount}
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-sm font-semibold text-ink-muted select-none">
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
              <label className="block text-sm font-medium text-ink-muted mb-1">
                {t.note} {newType === "other" && <span className="text-finance-loss">({t.noteRequiredBadge})</span>}
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

          {/* Solid Add Expense Button */}
          <button
            type="button"
            disabled={adding}
            onClick={handleAddExpense}
            className="w-full h-11 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm flex items-center justify-center transition-colors shadow-xs disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            {adding ? t.saving : t.addExpense}
          </button>

          {/* Contextual Inline Error Message */}
          {inlineError && (
            <div className="py-2 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between">
              <span>{inlineError}</span>
              <button
                type="button"
                onClick={() => setInlineError(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss"
              >
                ✕
              </button>
            </div>
          )}
        </section>
      )}

      {/* Operating Expenses List */}
      <section aria-label="Operating Expenses List" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.expenseTotal}
          </h2>
          <span className="text-base font-bold text-finance-loss">
            {formatMyr(totalExpenseSen)}
          </span>
        </div>

        <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs">
          {mergedExpenses.length === 0 ? (
            <div className="text-center py-6 text-sm text-ink-muted">
              {t.noExpensesRecorded}
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {mergedExpenses.map((item) => (
                <div
                  key={item.key}
                  className="py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary whitespace-nowrap">
                      {getCategoryLabel(item.type)}
                    </span>
                    {item.note && (
                      <span className="text-sm text-ink-muted truncate">
                        {item.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold text-finance-loss whitespace-nowrap">
                      {formatMyr(BigInt(item.amountSen))}
                    </span>
                    {!isClosed && (
                      <button
                        type="button"
                        disabled={deletingKey === item.key}
                        onClick={() => setPendingDeleteExpense(item)}
                        aria-label={t.delete}
                        className="w-11 h-11 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
                        title={t.delete}
                      >
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      {/* Delete Operating Expense Confirmation Modal */}
      {pendingDeleteExpense && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-expense-title"
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
                <p className="text-xs text-ink-muted mt-0.5">
                  {t.confirmDeleteItemDesc}
                </p>
              </div>
            </div>

            {/* Expense item detail snapshot */}
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
              <span className="text-base font-bold text-finance-loss whitespace-nowrap">
                {formatMyr(BigInt(pendingDeleteExpense.amountSen))}
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={deletingKey !== null}
                onClick={() => setPendingDeleteExpense(null)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer disabled:opacity-50"
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
                className="flex-1 h-11 rounded-xl bg-finance-loss hover:bg-finance-loss/90 btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer disabled:opacity-50"
              >
                {deletingKey !== null ? (
                  <span>...</span>
                ) : (
                  <span>{t.confirmDeleteBtn}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
