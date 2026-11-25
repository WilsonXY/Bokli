"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amountSizeClass, formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { apiFetch } from "@/lib/cloud-client";
import { useI18n, translateApiError, apiErrorPayloadFrom } from "@/lib/i18n";
import { useModalFocusTrap } from "@/lib/use-modal-focus-trap";
import { MonthSelectorDropdown, MonthOption } from "@/components/MonthSelectorDropdown";
import { MoneyValue, formatDisplayMyr } from "@/components/MoneyValue";
import type { OperatingExpenseType } from "@/services/operating-expense";

const SUCCESS_BANNER_MS = 3000;

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

export type ExpenseDraftField = "amount" | "note";

export function resolveExpenseDraftAfterAdd(
  touchedDuringAdd: ReadonlySet<ExpenseDraftField>
): { clearAmount: boolean; clearNote: boolean; closeDraft: boolean } {
  return {
    clearAmount: !touchedDuringAdd.has("amount"),
    clearNote: !touchedDuringAdd.has("note"),
    closeDraft: touchedDuringAdd.size === 0,
  };
}

export interface PendingExpenseAdd {
  key: string;
  body: string;
  createdAt: number;
  reported?: boolean;
}

export function resolveExpenseAddRequest(
  pending: readonly PendingExpenseAdd[],
  body: string,
  generateKey: () => string,
  now: number
): PendingExpenseAdd {
  return (
    pending.find((p) => p.body === body) ?? { key: generateKey(), body, createdAt: now }
  );
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PENDING_EXPENSE_ADDS_STORAGE_KEY = "bokli.pendingExpenseAdds";
export const PENDING_EXPENSE_ADD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getBrowserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPendingExpenseAdd(value: unknown): value is PendingExpenseAdd {
  const v = value as Partial<PendingExpenseAdd> | null;
  if (
    typeof v?.key !== "string" ||
    v.key === "" ||
    typeof v.body !== "string" ||
    typeof v.createdAt !== "number"
  ) {
    return false;
  }
  try {
    const body = JSON.parse(v.body);
    return typeof body?.type === "string" && typeof body?.amountSen === "number";
  } catch {
    return false;
  }
}

function readPendingExpenseAdds(storage: KeyValueStorage | null): PendingExpenseAdd[] {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(PENDING_EXPENSE_ADDS_STORAGE_KEY) ?? "[]"
    );
    return Array.isArray(parsed) ? parsed.filter(isPendingExpenseAdd) : [];
  } catch {
    return [];
  }
}

function writePendingExpenseAdds(
  storage: KeyValueStorage | null,
  entries: PendingExpenseAdd[]
): void {
  try {
    if (entries.length === 0) {
      storage?.removeItem(PENDING_EXPENSE_ADDS_STORAGE_KEY);
    } else {
      storage?.setItem(PENDING_EXPENSE_ADDS_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {}
}

export function loadPendingExpenseAdds(
  storage: KeyValueStorage | null,
  now: number
): PendingExpenseAdd[] {
  return readPendingExpenseAdds(storage).filter(
    (e) => now - e.createdAt <= PENDING_EXPENSE_ADD_MAX_AGE_MS
  );
}

export function savePendingExpenseAdd(
  storage: KeyValueStorage | null,
  pending: PendingExpenseAdd,
  now: number
): void {
  const others = loadPendingExpenseAdds(storage, now).filter(
    (e) => e.key !== pending.key
  );
  writePendingExpenseAdds(storage, [...others, pending]);
}

export function reusablePendingExpenseAdds(
  stored: readonly PendingExpenseAdd[],
  inPage: PendingExpenseAdd | null,
  confirmedKeys: ReadonlySet<string>
): PendingExpenseAdd[] {
  return [...stored, ...(inPage ? [inPage] : [])].filter(
    (e) => !confirmedKeys.has(e.key)
  );
}

export function markPendingExpenseAddReported(
  storage: KeyValueStorage | null,
  key: string
): void {
  const entries = readPendingExpenseAdds(storage);
  if (entries.some((e) => e.key === key)) {
    writePendingExpenseAdds(
      storage,
      entries.map((e) => (e.key === key ? { ...e, reported: true } : e))
    );
  }
}

export function clearPendingExpenseAdd(
  storage: KeyValueStorage | null,
  key: string
): void {
  const entries = readPendingExpenseAdds(storage);
  if (entries.some((e) => e.key === key)) {
    writePendingExpenseAdds(
      storage,
      entries.filter((e) => e.key !== key)
    );
  }
}

export function generateIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ExpenseCategoryIcon({ type }: { type: OperatingExpenseType }) {
  const tokenMap: Record<OperatingExpenseType, { bg: string; fg: string }> = {
    rental: { bg: "var(--op-rental-soft)", fg: "var(--op-rental)" },
    utilities: { bg: "var(--op-utilities-soft)", fg: "var(--op-utilities)" },
    wages: { bg: "var(--op-wages-soft)", fg: "var(--op-wages)" },
    other: { bg: "var(--op-other-soft)", fg: "var(--op-other)" },
  };
  const token = tokenMap[type];
  return (
    <span
      className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0"
      style={{ backgroundColor: token.bg, color: token.fg }}
      aria-hidden="true"
    >
      {type === "rental" && (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      )}
      {type === "utilities" && (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      )}
      {type === "wages" && (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      )}
      {type === "other" && (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        </svg>
      )}
    </span>
  );
}

interface ExpensesViewProps {
  onRefresh?: () => void;
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
  onRefresh,
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
  const refresh = onRefresh ?? (() => router.refresh());
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  const [expenses, setExpenses] = useState<OperatingExpenseItem[]>(initialExpenses);

  useEffect(() => {
    setExpenses(initialExpenses);
  }, [initialExpenses]);

  const mergedExpenses = useMemo(
    () => mergeOperatingExpenses(expenses),
    [expenses],
  );

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
  const touchedDuringAddRef = useRef<Set<ExpenseDraftField> | null>(null);
  const pendingAddRef = useRef<PendingExpenseAdd | null>(null);
  const addAttemptedRef = useRef(false);
  const confirmedKeysRef = useRef(new Set<string>());

  function markTouchedDuringAdd(field: ExpenseDraftField) {
    touchedDuringAddRef.current?.add(field);
  }

  const [inlineError, setInlineError] = useState<string | null>(initialInlineError);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSuccessTimer() {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }

  function dismissSuccessBanner() {
    clearSuccessTimer();
    setSuccessBanner(null);
  }

  function showSuccessBanner(message: string) {
    clearSuccessTimer();
    setSuccessBanner(message);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      setSuccessBanner(null);
    }, SUCCESS_BANNER_MS);
  }

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteExpenseError, setDeleteExpenseError] = useState<string | null>(null);
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

  useEffect(() => {
    const storage = getBrowserStorage();
    const unconfirmed = loadPendingExpenseAdds(storage, Date.now());
    if (unconfirmed.length === 0) return;

    let cancelled = false;
    const describe = (p: PendingExpenseAdd) => {
      const { type, amountSen } = JSON.parse(p.body) as {
        type: string;
        amountSen: number;
      };
      return `${getCategoryLabel(type)} ${formatMyr(BigInt(amountSen))}`;
    };

    Promise.all(
      unconfirmed.map((p) =>
        apiFetch(`/api/expenses?idempotencyKey=${encodeURIComponent(p.key)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { saved?: unknown } | null) =>
            typeof data?.saved === "boolean" ? data.saved : null
          )
          .catch(() => null)
      )
    ).then((answers) => {
      if (cancelled || addAttemptedRef.current) return;
      const saved = unconfirmed.filter((_, i) => answers[i] === true);
      const notSaved = unconfirmed.filter(
        (p, i) => answers[i] === false && !p.reported
      );

      for (const p of saved) {
        confirmedKeysRef.current.add(p.key);
        clearPendingExpenseAdd(storage, p.key);
      }
      for (const p of notSaved) markPendingExpenseAddReported(storage, p.key);

      if (saved.length > 0) {
        clearSuccessTimer();
        setSuccessBanner(`${t.lastAddSaved} · ${saved.map(describe).join(", ")}`);
        startTransition(() => {
          refresh();
        });
      }
      if (notSaved.length > 0) {
        setInlineError(`${t.lastAddNotSaved} · ${notSaved.map(describe).join(", ")}`);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteExpenseModalRef = useRef<HTMLDivElement>(null);
  const deleteExpenseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addExpenseBtnRef = useRef<HTMLButtonElement>(null);

  useModalFocusTrap({
    isOpen: pendingDeleteExpense !== null,
    containerRef: deleteExpenseModalRef,
    onClose: () => {
      setDeleteExpenseError(null);
      setPendingDeleteExpense(null);
    },
    canClose: deletingKey === null,
    returnFocusTo: deleteExpenseTriggerRef.current,
    fallbackFocusRef: addExpenseBtnRef,
  });

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (isClosed || adding) return;

    setInlineError(null);
    dismissSuccessBanner();

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

    touchedDuringAddRef.current = new Set<ExpenseDraftField>();
    setAdding(true);

    addAttemptedRef.current = true;
    const storage = getBrowserStorage();
    const now = Date.now();
    const request = resolveExpenseAddRequest(
      reusablePendingExpenseAdds(
        loadPendingExpenseAdds(storage, now),
        pendingAddRef.current,
        confirmedKeysRef.current
      ),
      JSON.stringify({
        month: currentMonth,
        type: newType,
        amountSen: Number(parsedSen),
        note: noteInput.trim() || undefined,
      }),
      generateIdempotencyKey,
      now
    );
    pendingAddRef.current = request;
    savePendingExpenseAdd(storage, request, now);

    try {
      const res = await apiFetch("/api/expenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": request.key,
        },
        body: request.body,
      });

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error ?? ""), { code: data.code });
      }
      pendingAddRef.current = null;
      confirmedKeysRef.current.add(request.key);
      clearPendingExpenseAdd(storage, request.key);

      setExpenses((prev) => {
        const exists = prev.some((item) => item.id === data.expense.id);
        return exists
          ? prev.map((item) => (item.id === data.expense.id ? data.expense : item))
          : [...prev, data.expense];
      });
      const rebase = resolveExpenseDraftAfterAdd(
        touchedDuringAddRef.current ?? new Set<ExpenseDraftField>()
      );
      if (rebase.clearAmount) setAmountInput("");
      if (rebase.clearNote) setNoteInput("");
      setAmountError(false);
      setNoteError(false);
      if (rebase.closeDraft) setIsDraftOpen(false);
      showSuccessBanner(t.addExpenseSuccess);

      startTransition(() => {
        refresh();
      });
    } catch (err) {
      setInlineError(translateApiError(apiErrorPayloadFrom(err), t));
    } finally {
      touchedDuringAddRef.current = null;
      setAdding(false);
    }
  }

  async function handleDeleteExpense(key: string, ids: number[]): Promise<boolean> {
    if (isClosed || deletingKey !== null) return false;
    setInlineError(null);
    setDeleteExpenseError(null);
    dismissSuccessBanner();
    deleteExpenseModalRef.current?.focus();
    setDeletingKey(key);

    const deletedIds: number[] = [];
    let succeeded = false;
    try {
      const res = await apiFetch("/api/expenses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(
          new Error(data.error || "Failed to delete expense"),
          { code: data.code }
        );
      }
      deletedIds.push(...ids);
      succeeded = true;
      showSuccessBanner(t.deleteExpenseSuccess);
    } catch (err) {
      setDeleteExpenseError(translateApiError(apiErrorPayloadFrom(err), t));
      requestAnimationFrame(() => {
        deleteExpenseModalRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      });
    } finally {
      if (deletedIds.length > 0) {
        setExpenses((prev) => prev.filter((item) => !deletedIds.includes(item.id)));
        startTransition(() => {
          refresh();
        });
      }
      setDeletingKey(null);
    }
    return succeeded;
  }

  const totalExpenseSen = useMemo(() => {
    return expenses.reduce((acc, curr) => acc + BigInt(curr.amountSen), 0n);
  }, [expenses]);

  const netAfterExpenseSen = summary ? BigInt(summary.grossSen) - totalExpenseSen : null;
  const grossSenBig = summary ? BigInt(summary.grossSen) : null;
  const positiveGrossSen = grossSenBig !== null && grossSenBig > 0n ? grossSenBig : 0n;
  const isOverGross =
    summary !== null && summary !== undefined && totalExpenseSen > positiveGrossSen;
  const overrunSen = isOverGross ? totalExpenseSen - positiveGrossSen : 0n;
  const grossSharePct =
    summary && summary.grossSen > 0
      ? Math.round((Number(totalExpenseSen) / summary.grossSen) * 100)
      : null;
  const grossShareBarWidth =
    grossSharePct !== null ? Math.min(100, Math.max(0, grossSharePct)) : 0;

  return (
    <div className="space-y-6">
      {/* Polite mutation status region outside aria-busy dialogs so assistive tech announces immediately */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {deletingKey !== null ? t.deleting : adding ? t.saving : ""}
      </span>

      {/* Header & Month Selector — Stacks cleanly on narrow mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-primary tracking-tight">
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
          {isClosed && (
            <div className="py-2.5 px-4 bg-status-closed-bg border border-status-closed/20 rounded-xl text-status-closed text-sm font-semibold flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>{t.monthLocked}</span>
            </div>
          )}

          {inlineError && (
            <div role="alert" className="py-2.5 px-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-start justify-between gap-2 shadow-card animate-slide-down">
              <div className="flex items-start gap-2 min-w-0">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="break-words whitespace-normal">{inlineError}</span>
              </div>
              <button
                type="button"
                onClick={() => setInlineError(null)}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-7 h-7 flex items-center justify-center rounded-lg shrink-0 cursor-pointer"
                aria-label={t.closeLabel}
              >
                ✕
              </button>
            </div>
          )}

          {successBanner && (
            <div className="py-2.5 px-4 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/30 text-sm text-brand-broccoli font-semibold flex items-center justify-between shadow-card animate-slide-down">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-brand-broccoli" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="truncate">{successBanner}</span>
              </div>
              <button
                type="button"
                onClick={dismissSuccessBanner}
                className="text-xs font-bold ml-2 text-ink-muted hover:text-brand-broccoli w-7 h-7 flex items-center justify-center rounded-lg shrink-0 cursor-pointer"
                aria-label={t.closeLabel}
              >
                ✕
              </button>
            </div>
          )}

          {/* Responsive 2-Column Layout: Ruled Ledger Summary leads on top (mobile) and left (desktop); Register follows */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Summary Column — Hero Operating Expenses + Explicit Share Bar (--finance-opex) + Ruled Gross-to-Net Ledger */}
            {summary && netAfterExpenseSen !== null && (
              <section
                aria-label={t.monthSummary}
                className="lg:col-span-5 lg:sticky lg:top-8 bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden"
              >
                <div className="px-3.5 py-4 sm:p-6 space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-ink-muted">
                      {t.expensesThisMonthLabel}
                    </div>
                    <div
                      className={`mt-1.5 ${amountSizeClass(
                        formatDisplayMyr(totalExpenseSen),
                        "text-2xl",
                        "text-3xl"
                      )} sm:text-4xl font-bold tracking-tight text-ink-primary`}
                    >
                      <MoneyValue sen={totalExpenseSen} variant="hero" />
                    </div>
                  </div>

                  {(grossSharePct !== null || isOverGross) && (
                    <div className="space-y-2 pt-0.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-ink-secondary font-medium">
                          {t.opexShareSentence}
                        </span>
                        {grossSharePct !== null && (
                          <span
                            className={`num-tabular font-bold shrink-0 ${
                              isOverGross ? "text-finance-loss" : "text-ink-primary"
                            }`}
                          >
                            {grossSharePct}%
                          </span>
                        )}
                      </div>
                      {isOverGross && totalExpenseSen > 0n ? (
                        (() => {
                          const rawOverrunPct =
                            (Number(overrunSen) / Number(totalExpenseSen)) * 100;
                          const overrunPct =
                            positiveGrossSen === 0n
                              ? 100
                              : Math.min(100, Math.max(2, Number(rawOverrunPct.toFixed(1))));
                          const coveredPct = Math.max(0, Number((100 - overrunPct).toFixed(1)));
                          const hasPositiveGross = positiveGrossSen > 0n;
                          const overrunLabel = hasPositiveGross
                            ? t.expensesOverrunCaption.replace(
                                "{overrun}",
                                formatDisplayMyr(overrunSen)
                              )
                            : t.expensesUncoveredCaption.replace(
                                "{amount}",
                                formatDisplayMyr(totalExpenseSen)
                              );
                          return (
                            <>
                              <div className="relative py-0.5" aria-label={overrunLabel}>
                                <div className="w-full h-2.5 rounded-full bg-surface-subtle overflow-hidden flex">
                                  {coveredPct > 0 && (
                                    <div
                                      className="h-full bg-finance-opex transition-all duration-300"
                                      style={{ width: `${coveredPct}%` }}
                                      title={`${t.opexCoveredLabel}: ${formatDisplayMyr(positiveGrossSen)}`}
                                    />
                                  )}
                                  <div
                                    className="h-full bg-finance-loss transition-all duration-300"
                                    style={{ width: `${overrunPct}%` }}
                                    title={overrunLabel}
                                  />
                                </div>
                                {coveredPct > 0 && coveredPct < 100 && (
                                  <span
                                    aria-hidden="true"
                                    style={{ left: `${coveredPct}%` }}
                                    title={`${t.grossProfitBoundaryLabel}: ${formatDisplayMyr(positiveGrossSen)}`}
                                    className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-[2px] rounded-full bg-ink-primary -translate-x-1/2 ring-1 ring-surface"
                                  />
                                )}
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs num-tabular">
                                {hasPositiveGross && (
                                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                                    <span className="w-1.5 h-1.5 rounded-full bg-finance-opex shrink-0" aria-hidden="true" />
                                    <span>
                                      {t.grossProfitBoundaryLabel} <MoneyValue sen={positiveGrossSen} />
                                    </span>
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1.5 text-finance-loss font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-finance-loss shrink-0" aria-hidden="true" />
                                  <span>{overrunLabel}</span>
                                </span>
                              </div>
                            </>
                          );
                        })()
                      ) : (
                        <div className="w-full h-2.5 rounded-full bg-surface-subtle overflow-hidden">
                          <div
                            className="h-full rounded-full bg-finance-opex transition-all duration-300"
                            style={{ width: `${grossShareBarWidth}%` }}
                            title={`${t.opexShareSentence}: ${grossSharePct ?? 0}%`}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Ruled Gross-to-Net Ledger Breakdown (matching Month Close Book Summary) */}
                <div className="px-3.5 py-4 sm:px-6 sm:py-5 border-t border-surface-border bg-surface-subtle/40 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-secondary">{t.monthGrossProfit}</span>
                    <span
                      className={`${amountSizeClass(
                        formatDisplayMyr(BigInt(summary.grossSen)),
                        "text-xs",
                        "text-base"
                      )} sm:text-base font-bold text-ink-primary`}
                    >
                      <MoneyValue sen={BigInt(summary.grossSen)} />
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-muted">{t.operatingExpenses}</span>
                    <span
                      className={`${amountSizeClass(
                        formatDisplayMyr(totalExpenseSen),
                        "text-xs",
                        "text-base"
                      )} sm:text-base font-semibold text-ink-secondary num-tabular`}
                    >
                      {totalExpenseSen > 0n ? "\u2212" : ""}
                      <MoneyValue sen={totalExpenseSen} />
                    </span>
                  </div>

                  <div className="pt-2.5 border-t border-surface-border flex items-baseline justify-between gap-3">
                    <span className="font-bold text-ink-secondary">{t.netProfit}</span>
                    <span
                      className={`${amountSizeClass(
                        formatDisplayMyr(netAfterExpenseSen),
                        "text-base",
                        "text-xl"
                      )} sm:text-2xl font-bold tracking-tight ${
                        netAfterExpenseSen >= 0n
                          ? "text-finance-profit"
                          : "text-finance-loss"
                      }`}
                    >
                      <MoneyValue sen={netAfterExpenseSen} variant="metric" />
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* Operating Expenses Register & Add Form Column */}
            <section
              aria-label={t.expensesTitle}
              className={`${summary ? "lg:col-span-7" : "lg:col-span-12"} space-y-4`}
            >
              <div className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
                <div className="px-3.5 py-3.5 sm:px-6 sm:py-4 border-b border-surface-border flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-base font-bold text-ink-primary">
                      {t.expensesListTitle}
                    </h2>
                    {mergedExpenses.length > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-ink-muted border border-surface-border num-tabular shrink-0">
                        {mergedExpenses.length}{" "}
                        {mergedExpenses.length === 1 ? t.itemUnitSingular : t.itemsUnit}
                      </span>
                    )}
                  </div>
                  {!summary && (
                    <MoneyValue
                      sen={totalExpenseSen}
                      className="text-sm font-bold text-ink-secondary"
                    />
                  )}
                </div>

                {mergedExpenses.length > 0 ? (
                  <div className="divide-y divide-surface-border">
                    {mergedExpenses.map((item) => (
                      <div
                        key={item.key}
                        className="pl-3.5 pr-1 sm:pl-6 sm:pr-2 py-3 flex items-center justify-between gap-2 sm:gap-3 hover:bg-surface-subtle/40 transition-colors"
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <ExpenseCategoryIcon type={item.type} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-semibold text-ink-primary truncate">
                                {getCategoryLabel(item.type)}
                              </span>
                              {item.ids.length > 1 && (
                                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-surface-subtle text-ink-muted border border-surface-border num-tabular shrink-0">
                                  ×{item.ids.length}
                                </span>
                              )}
                            </div>
                            {item.note && (
                              <div className="text-xs text-ink-muted break-words whitespace-normal leading-snug mt-0.5">
                                {item.note}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                          <span
                            className={`${amountSizeClass(
                              formatDisplayMyr(BigInt(item.amountSen)),
                              "text-xs",
                              "text-sm sm:text-base"
                            )} font-bold text-ink-primary whitespace-nowrap`}
                          >
                            <MoneyValue sen={BigInt(item.amountSen)} />
                          </span>

                          {!isClosed && (
                            <button
                              type="button"
                              onClick={(e) => {
                                deleteExpenseTriggerRef.current = e.currentTarget;
                                setDeleteExpenseError(null);
                                setPendingDeleteExpense(item);
                              }}
                              aria-label={`${t.delete} ${getCategoryLabel(item.type)}`}
                              title={t.delete}
                              className="w-12 h-12 rounded-xl hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  !isDraftOpen && (
                    <div className="p-8 text-center text-sm text-ink-muted">
                      {t.noExpensesRecorded}
                    </div>
                  )
                )}

                {/* Inline Add Expense Form */}
                {isDraftOpen && !isClosed && (
                  <div className="border-t border-brand-broccoli/30 bg-surface-subtle/35">
                    <form onSubmit={handleAddExpense} className="px-3.5 py-4 sm:p-6 space-y-4">
                      <div>
                        <span className="block text-xs font-semibold text-ink-muted mb-2">
                          {t.expenseCategory}
                        </span>
                        <div className="flex flex-wrap gap-2">
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
                                className={`min-h-[48px] lg:min-h-[44px] px-3.5 py-2 rounded-xl text-sm font-semibold border btn-tactile select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli disabled:opacity-50 cursor-pointer ${
                                  isSelected
                                    ? "bg-brand-cta text-brand-cta-ink border-brand-cta shadow-card"
                                    : "bg-surface border-surface-border text-ink-secondary hover:border-surface-border-strong hover:text-ink-primary"
                                }`}
                              >
                                {cat.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="expense-amount-input" className="block text-xs font-semibold text-ink-secondary mb-1.5">
                            {t.amount} <span className="text-finance-loss">*</span>
                          </label>
                          <div className="relative flex items-center">
                            <span className="absolute left-3.5 text-sm font-bold text-ink-muted select-none">
                              RM
                            </span>
                            <input
                              id="expense-amount-input"
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
                              className={`w-full h-12 pl-11 pr-3 rounded-xl bg-surface-input border ${
                                amountError ? "border-finance-loss" : "border-surface-border-strong"
                              } text-base font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface ${
                                amountError
                                  ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                  : "focus:border-brand-broccoli focus-visible:ring-brand-broccoli/30"
                              } focus-visible:ring-2 transition-colors`}
                            />
                          </div>
                          {amountError && (
                            <div
                              id="expense-amount-error"
                              role="alert"
                              className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium"
                            >
                              <span>{t.invalidAmount}</span>
                            </div>
                          )}
                        </div>

                        <div>
                          <label htmlFor="expense-note-input" className="block text-xs font-semibold text-ink-secondary mb-1.5">
                            {t.note} {newType === "other" && <span className="text-finance-loss">*</span>}
                          </label>
                          <input
                            id="expense-note-input"
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
                            className={`w-full h-12 px-3.5 rounded-xl bg-surface-input border ${
                              noteError ? "border-finance-loss" : "border-surface-border-strong"
                            } text-sm text-ink-primary focus:outline-none focus:bg-surface ${
                              noteError
                                ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                : "focus:border-brand-broccoli focus-visible:ring-brand-broccoli/30"
                            } focus-visible:ring-2 transition-colors`}
                          />
                          {noteError && (
                            <div
                              id="expense-note-error"
                              role="alert"
                              className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium"
                            >
                              <span>{t.otherNoteRequired}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 pt-1">
                        <button
                          type="button"
                          disabled={adding}
                          onClick={() => {
                            setIsDraftOpen(false);
                            setAmountInput("");
                            setNoteInput("");
                            setAmountError(false);
                            setNoteError(false);
                            if (inlineError) setInlineError(null);
                          }}
                          className="flex-1 min-h-[48px] rounded-xl border border-surface-border bg-surface hover:bg-surface-subtle text-ink-secondary font-semibold text-sm btn-tactile cursor-pointer"
                        >
                          {t.cancel}
                        </button>
                        <button
                          type="submit"
                          disabled={adding}
                          className="flex-1 min-h-[48px] rounded-xl bg-brand-cta hover:bg-brand-cta-hover btn-tactile text-brand-cta-ink font-semibold text-sm shadow-card cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {adding ? t.saving : t.addExpense}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Add Expense Footer Action */}
                {!isClosed && !isDraftOpen && (
                  <div className="px-3.5 py-3 sm:px-6 sm:py-4 border-t border-surface-border bg-surface-subtle/30">
                    <button
                      ref={addExpenseBtnRef}
                      type="button"
                      onClick={() => setIsDraftOpen(true)}
                      className="w-full min-h-[48px] px-4 rounded-xl bg-brand-broccoli-light hover:bg-brand-broccoli/15 border border-brand-broccoli/25 shadow-control text-brand-broccoli font-semibold text-sm btn-tactile flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <span>{t.addExpense}</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Delete Item Confirmation Dialog (viewport-bounded with scrollable long notes so actions stay reachable) */}
          {pendingDeleteExpense && (
            <div
              ref={deleteExpenseModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-busy={deletingKey !== null}
              aria-labelledby="confirm-delete-expense-title"
              aria-describedby="confirm-delete-expense-desc"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down focus:outline-none"
              onClick={(e) => {
                if (e.target === e.currentTarget && deletingKey === null) {
                  setDeleteExpenseError(null);
                  setPendingDeleteExpense(null);
                }
              }}
            >
              <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] flex flex-col bg-surface rounded-2xl p-6 shadow-popover border border-surface-border gap-5 overflow-hidden">
                <div className="flex items-center gap-3.5 shrink-0">
                  <div className="w-11 h-11 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss flex items-center justify-center shrink-0 select-none">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
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

                <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface border border-surface-border text-ink-secondary whitespace-nowrap">
                      {getCategoryLabel(pendingDeleteExpense.type)}
                    </span>
                    <span
                      className={`${amountSizeClass(
                        formatDisplayMyr(BigInt(pendingDeleteExpense.amountSen)),
                        "text-xs",
                        "text-base"
                      )} font-bold text-finance-loss whitespace-nowrap`}
                    >
                      <MoneyValue sen={BigInt(pendingDeleteExpense.amountSen)} />
                    </span>
                  </div>
                  {pendingDeleteExpense.note && (
                    <p
                      tabIndex={0}
                      aria-label={t.note}
                      className="min-h-0 flex-1 max-h-36 overflow-y-auto px-2.5 py-2 rounded-lg bg-surface/75 border border-surface-border/80 text-xs text-ink-secondary break-words whitespace-normal leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                    >
                      {pendingDeleteExpense.note}
                    </p>
                  )}
                </div>

                {deleteExpenseError && (
                  <p role="alert" className="text-sm font-semibold text-finance-loss text-center break-words whitespace-normal shrink-0">
                    {deleteExpenseError}
                  </p>
                )}

                <div className="flex items-center gap-2.5 pt-1 shrink-0">
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={() => {
                      setDeleteExpenseError(null);
                      setPendingDeleteExpense(null);
                    }}
                    className="flex-1 min-h-[48px] rounded-xl border border-surface-border bg-surface hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli disabled:opacity-50 cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={deletingKey !== null}
                    onClick={async () => {
                      const ok = await handleDeleteExpense(
                        pendingDeleteExpense.key,
                        pendingDeleteExpense.ids
                      );
                      if (ok) {
                        setDeleteExpenseError(null);
                        setPendingDeleteExpense(null);
                      }
                    }}
                    className="flex-1 min-h-[48px] rounded-xl bg-danger-cta hover:bg-danger-cta-hover btn-tactile text-danger-cta-ink font-semibold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {deletingKey !== null ? t.deleting : t.confirmDeleteBtn}
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
