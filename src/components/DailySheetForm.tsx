"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError } from "@/lib/i18n";
import { CalendarPopover } from "@/components/CalendarPopover";

export interface CostLineItem {
  id?: number;
  category: "restock" | "gas" | "transport" | "wages-daily" | "maintenance" | "other";
  amountSen: number;
  note?: string | null;
}

export interface DailySheetFormProps {
  date: string;
  initialCashSen: number;
  initialTngSen: number;
  initialCostLines: CostLineItem[];
  isClosed: boolean;
  todayKl: string;
  initialCashInput?: string;
  initialTngInput?: string;
}

function normalizeCostLine(line: CostLineItem): CostLineItem {
  return {
    ...line,
    note: line.note?.trim() || null,
  };
}

function senToDecimalStr(sen: number): string {
  if (!sen) return "";
  const ringgit = Math.floor(sen / 100);
  const cents = (sen % 100).toString().padStart(2, "0");
  return cents === "00" ? `${ringgit}` : `${ringgit}.${cents}`;
}

// Safe parsing helper: returns null for unparseable non-empty inputs
export function toSen(val: string): bigint | null {
  const s = val.trim();
  if (!s) return 0n;
  try {
    return parseSen(s);
  } catch {
    return null;
  }
}

export function DailySheetForm({
  date,
  initialCashSen,
  initialTngSen,
  initialCostLines,
  isClosed,
  todayKl,
  initialCashInput,
  initialTngInput,
}: DailySheetFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  const categories: Array<{
    key: CostLineItem["category"];
    label: string;
  }> = [
    { key: "restock", label: t.catRestock },
    { key: "gas", label: t.catGas },
    { key: "transport", label: t.catTransport },
    { key: "wages-daily", label: t.catWagesDaily },
    { key: "maintenance", label: t.catMaintenance },
    { key: "other", label: t.catOther },
  ];

  // Calendar popover toggle state & trigger ref
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  // Revenue inputs state
  const initCashStr = initialCashInput !== undefined ? initialCashInput : senToDecimalStr(initialCashSen);
  const initTngStr = initialTngInput !== undefined ? initialTngInput : senToDecimalStr(initialTngSen);
  const [cashInput, setCashInput] = useState(initCashStr);
  const [tngInput, setTngInput] = useState(initTngStr);

  // Cost lines state - distinct same-category+same-note rows remain representable
  const [costLines, setCostLines] = useState<CostLineItem[]>(() =>
    initialCostLines.map(normalizeCostLine)
  );

  // New cost line draft
  const [newCat, setNewCat] = useState<CostLineItem["category"]>("restock");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");

  // Feedback states
  const [costLineError, setCostLineError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

  // Close modals on Escape key
  useEffect(() => {
    if (!showConfirmModal && pendingDeleteIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowConfirmModal(false);
        setPendingDeleteIndex(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showConfirmModal, pendingDeleteIndex]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Baseline state representing the saved/initial state for the selected date
  const [baseline, setBaseline] = useState(() => ({
    cashInput: initCashStr,
    tngInput: initTngStr,
    costLines: initialCostLines.map(normalizeCostLine),
  }));

  // Check if current form inputs differ from baseline
  const isModified = useMemo(() => {
    if (cashInput.trim() !== baseline.cashInput.trim()) return true;
    if (tngInput.trim() !== baseline.tngInput.trim()) return true;
    if (newAmount.trim() !== "" || newNote.trim() !== "") return true;
    if (costLines.length !== baseline.costLines.length) return true;

    for (let i = 0; i < costLines.length; i++) {
      const curr = costLines[i];
      const base = baseline.costLines[i];
      if (
        !base ||
        curr.id !== base.id ||
        curr.category !== base.category ||
        curr.amountSen !== base.amountSen ||
        (curr.note || null) !== (base.note || null)
      ) {
        return true;
      }
    }
    return false;
  }, [cashInput, tngInput, newAmount, newNote, costLines, baseline]);

  // Update form inputs when selected date or initial data changes
  useEffect(() => {
    const cashStr = initialCashInput !== undefined ? initialCashInput : senToDecimalStr(initialCashSen);
    const tngStr = initialTngInput !== undefined ? initialTngInput : senToDecimalStr(initialTngSen);
    setCashInput(cashStr);
    setTngInput(tngStr);
    setCostLines(initialCostLines.map(normalizeCostLine));
    setBaseline({
      cashInput: cashStr,
      tngInput: tngStr,
      costLines: initialCostLines.map(normalizeCostLine),
    });
    setNewAmount("");
    setNewNote("");
    setCostLineError(null);
    setErrorMessage(null);
  }, [date, initialCashSen, initialTngSen, initialCashInput, initialTngInput, initialCostLines]);

  // Revert modifications back to baseline
  function handleRevert() {
    setCashInput(baseline.cashInput);
    setTngInput(baseline.tngInput);
    setCostLines(baseline.costLines);
    setNewAmount("");
    setNewNote("");
    setNewCat("restock");
    setCostLineError(null);
    setErrorMessage(null);
  }

  const cashSen = toSen(cashInput);
  const tngSen = toSen(tngInput);
  const cashError = cashInput.trim() !== "" && cashSen === null;
  const tngError = tngInput.trim() !== "" && tngSen === null;
  const hasParseError = cashError || tngError;

  const totalRevenueSen =
    hasParseError || cashSen === null || tngSen === null
      ? null
      : cashSen + tngSen;

  const totalCostSen = costLines.reduce(
    (acc, line) => acc + BigInt(line.amountSen),
    0n,
  );

  const grossProfitSen =
    totalRevenueSen !== null ? totalRevenueSen - totalCostSen : null;

  // Add Cost Line (preserves distinct rows without silent collapsing)
  function handleAddCostLine() {
    setCostLineError(null);
    const amountVal = toSen(newAmount);

    if (amountVal === null || amountVal <= 0n) {
      setCostLineError(t.invalidAmount);
      return;
    }

    if (newCat === "other" && !newNote.trim()) {
      setCostLineError(t.otherNoteRequired);
      return;
    }

    const trimmedNote = newNote.trim() || null;

    setCostLines((prev) => [
      ...prev,
      {
        category: newCat,
        amountSen: Number(amountVal),
        note: trimmedNote,
      },
    ]);

    setNewAmount("");
    setNewNote("");
    setCostLineError(null);
  }

  // Remove Cost Line
  function handleRemoveCostLine(index: number) {
    if (isClosed) return;
    setCostLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Save full sheet
  async function handleSave() {
    if (saving) return;
    if (isClosed) return;
    if (hasParseError || cashSen === null || tngSen === null) {
      setErrorMessage(t.invalidAmount);
      return;
    }
    setErrorMessage(null);
    setCostLineError(null);
    setSuccessMessage(null);

    setSaving(true);

    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          cashSen: Number(cashSen),
          tngSen: Number(tngSen),
          costLines: costLines.map((l) => ({
            category: l.category,
            amountSen: l.amountSen,
            note: l.note || undefined,
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(translateApiError(data.error, t));
      }

      if (data.sheet && Array.isArray(data.costLines)) {
        const savedCostLines: CostLineItem[] = data.costLines.map((l: any) =>
          normalizeCostLine({
            id: l.id,
            category: l.category,
            amountSen: Number(l.amountSen),
            note: l.note || undefined,
          })
        );
        const savedCash = senToDecimalStr(Number(data.sheet.cashSen));
        const savedTng = senToDecimalStr(Number(data.sheet.tngSen));

        setBaseline({
          cashInput: savedCash,
          tngInput: savedTng,
          costLines: savedCostLines,
        });
        setCostLines(savedCostLines);
        setCashInput(savedCash);
        setTngInput(savedTng);
      }

      setSuccessMessage(t.saveSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setErrorMessage(translateApiError(err.message, t));
    } finally {
      setSaving(false);
    }
  }

  // Navigation between dates
  function navigateDate(offsetDays: number) {
    const current = new Date(`${date}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + offsetDays);
    const targetStr = current.toISOString().slice(0, 10);
    if (targetStr > todayKl) return; // Block future
    router.push(`/?date=${targetStr}`);
  }

  const isToday = date === todayKl;
  const canGoNext = date < todayKl;

  const getCategoryLabel = (key: string) => {
    const found = categories.find((c) => c.key === key);
    return found ? found.label : key;
  };

  return (
    <div className="space-y-4">
      {/* Date Bar with Calendar Toggle Popover & Lock Notice */}
      <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            aria-label={t.prevDay}
            title={t.prevDay}
            className="w-11 h-11 shrink-0 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors sm:w-auto sm:px-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline whitespace-nowrap">{t.prevDay}</span>
          </button>

          {/* Toggleable Date Button with Calendar Popover */}
          <div className="relative min-w-0">
            <button
              ref={dateBtnRef}
              type="button"
              onClick={() => setIsCalendarOpen((prev) => !prev)}
              aria-expanded={isCalendarOpen}
              aria-haspopup="dialog"
              className="relative text-center group cursor-pointer px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors focus:outline-none max-w-full"
              title="点击打开/关闭日历 (Click to toggle calendar)"
            >
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                <span className="text-base font-bold text-ink-primary group-hover:text-brand-broccoli transition-colors">
                  {date}
                </span>
                {isToday && (
                  <span className="text-[13px] px-2 py-0.5 rounded bg-brand-broccoli-light font-semibold text-brand-broccoli">
                    {t.today}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-ink-muted">
                {t.klTime}
              </p>
            </button>

            {/* Calendar Popover */}
            <CalendarPopover
              date={date}
              todayKl={todayKl}
              isOpen={isCalendarOpen}
              triggerRef={dateBtnRef}
              onClose={() => setIsCalendarOpen(false)}
              onSelectDate={(newDate) => {
                router.push(`/?date=${newDate}`);
              }}
            />
          </div>

          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => navigateDate(1)}
            aria-label={t.nextDay}
            title={t.nextDay}
            className="w-11 h-11 shrink-0 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 disabled:pointer-events-none sm:w-auto sm:px-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            <span className="hidden sm:inline whitespace-nowrap">{t.nextDay}</span>
            <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {isClosed && (
          <div className="py-2 px-3 rounded-lg bg-status-closed-bg/60 border border-status-closed/20 flex items-center gap-2 text-sm font-medium text-status-closed">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>{t.monthLocked}</span>
          </div>
        )}
      </div>

      {/* Section 1: Revenue Entry */}
      <section aria-label="Revenue Entry" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.revenueTitle}
          </h2>
          <span className="text-sm font-medium text-ink-muted">
            {t.totalRevenue}: <span className="font-semibold text-ink-primary">{totalRevenueSen !== null ? formatMyr(totalRevenueSen) : "—"}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Cash Revenue Card */}
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs focus-within:border-channel-cash transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-channel-cash inline-block shrink-0" />
              <label
                htmlFor="cash-input"
                className="text-sm font-semibold text-ink-primary"
              >
                {t.cashRevenue}
              </label>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-sm font-bold text-channel-cash select-none">
                RM
              </span>
              <input
                id="cash-input"
                type="text"
                inputMode="decimal"
                disabled={isClosed}
                value={cashInput}
                onChange={(e) => {
                  const sanitized = sanitizeMoneyInput(e.target.value);
                  if (sanitized !== null) {
                    setCashInput(sanitized);
                    if (errorMessage) setErrorMessage(null);
                  }
                }}
                placeholder="0.00"
                className={`w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border ${
                  cashError ? "border-finance-loss" : "border-surface-border"
                } text-lg font-bold text-ink-primary focus:outline-none focus:bg-white ${
                  cashError
                    ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                    : "focus:border-channel-cash focus-visible:ring-channel-cash/50"
                } focus-visible:ring-2 disabled:opacity-60 transition-colors`}
              />
            </div>
            {cashError && (
              <div className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
                <span>{t.invalidAmount}</span>
              </div>
            )}
          </div>

          {/* Touch 'n Go Revenue Card */}
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs focus-within:border-channel-tng transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-channel-tng inline-block shrink-0" />
              <label
                htmlFor="tng-input"
                className="text-sm font-semibold text-ink-primary"
              >
                {t.tngRevenue}
              </label>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-sm font-bold text-channel-tng select-none">
                RM
              </span>
              <input
                id="tng-input"
                type="text"
                inputMode="decimal"
                disabled={isClosed}
                value={tngInput}
                onChange={(e) => {
                  const sanitized = sanitizeMoneyInput(e.target.value);
                  if (sanitized !== null) {
                    setTngInput(sanitized);
                    if (errorMessage) setErrorMessage(null);
                  }
                }}
                placeholder="0.00"
                className={`w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border ${
                  tngError ? "border-finance-loss" : "border-surface-border"
                } text-lg font-bold text-ink-primary focus:outline-none focus:bg-white ${
                  tngError
                    ? "focus:border-finance-loss focus-visible:ring-finance-loss/50"
                    : "focus:border-channel-tng focus-visible:ring-channel-tng/50"
                } focus-visible:ring-2 disabled:opacity-60 transition-colors`}
              />
            </div>
            {tngError && (
              <div className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
                <span>{t.invalidAmount}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section 2: Itemized Daily Costs */}
      <section aria-label="Daily Costs Entry" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.costsTitle}
          </h2>
          <span className="text-sm font-medium text-ink-muted">
            {t.totalCosts}: <span className="font-semibold text-finance-loss">{formatMyr(totalCostSen)}</span>
          </span>
        </div>

        {/* Cost Line Entry Box */}
        {!isClosed && (
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs space-y-2.5">
            <div>
              <span className="block text-sm font-medium text-ink-muted mb-1.5">
                {t.selectCategory}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const isSelected = newCat === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setNewCat(cat.key);
                        if (costLineError) setCostLineError(null);
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
                    value={newAmount}
                    onChange={(e) => {
                      const sanitized = sanitizeMoneyInput(e.target.value);
                      if (sanitized !== null) {
                        setNewAmount(sanitized);
                        if (costLineError) setCostLineError(null);
                      }
                    }}
                    placeholder="0.00"
                    className="w-full h-11 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-base font-semibold text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1">
                  {t.note} {newCat === "other" && <span className="text-finance-loss">({t.noteRequiredBadge})</span>}
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => {
                    setNewNote(e.target.value);
                    if (costLineError) setCostLineError(null);
                  }}
                  placeholder={newCat === "other" ? t.noteRequired : t.noteOptional}
                  className="w-full h-11 px-2.5 rounded-lg bg-surface-canvas border border-surface-border text-sm text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50"
                />
              </div>
            </div>

            {/* Solid "Add Cost" / "添加开销" button */}
            <button
              type="button"
              onClick={handleAddCostLine}
              className="w-full h-11 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm flex items-center justify-center transition-colors shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
            >
              {t.addCostLine}
            </button>

            {/* Contextual Error Message Directly Below the Cost Card Button */}
            {costLineError && (
              <div className="py-2 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between">
                <span>{costLineError}</span>
                <button
                  type="button"
                  onClick={() => setCostLineError(null)}
                  className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {/* Existing Cost Lines List */}
        <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs">
          {costLines.length === 0 ? (
            <div className="text-center py-5 text-sm text-ink-muted">
              {t.noCostsRecorded}
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {costLines.map((line, idx) => (
                <div
                  key={`${line.id ?? "new"}-${line.category}-${line.note || ""}-${idx}`}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary whitespace-nowrap">
                      {getCategoryLabel(line.category)}
                    </span>
                    {line.note && (
                      <span className="text-sm text-ink-muted truncate">
                        {line.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold text-finance-loss whitespace-nowrap">
                      {formatMyr(BigInt(line.amountSen))}
                    </span>
                    {!isClosed && (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteIndex(idx)}
                        aria-label={t.delete}
                        className="w-11 h-11 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
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

      {/* Sticky Bottom Action Bar & Notifications */}
      <div className="sticky bottom-16 z-30 space-y-2">
        {errorMessage && (
          <div className="py-2.5 px-3.5 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between shadow-md animate-slide-down">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="truncate">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-7 h-7 flex items-center justify-center rounded-md shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}

        {successMessage && (
          <div className="py-2.5 px-3.5 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/30 text-sm text-brand-broccoli font-bold flex items-center justify-between shadow-md animate-slide-down">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 shrink-0 text-brand-broccoli" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="truncate">{successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="text-xs font-bold ml-2 text-ink-muted hover:text-brand-broccoli w-7 h-7 flex items-center justify-center rounded-md shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}

        <div className="bg-white/95 backdrop-blur-md border border-surface-border rounded-xl p-3 shadow-sm flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] text-ink-muted font-medium">
              {t.grossProfit}
            </div>
            <div
              className={`text-xl font-bold ${
                grossProfitSen !== null && grossProfitSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
              }`}
            >
              {grossProfitSen !== null ? formatMyr(grossProfitSen) : "—"}
            </div>
          </div>

          {!isClosed && (
            <div className="flex items-center gap-2">
              {isModified && (
                <button
                  type="button"
                  onClick={handleRevert}
                  disabled={saving}
                  title={t.undoChanges}
                  aria-label={t.undoChanges}
                  className="h-12 w-12 shrink-0 rounded-lg border border-surface-border bg-white hover:bg-surface-subtle text-ink-secondary hover:text-ink-primary shadow-xs flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 active:scale-95 cursor-pointer disabled:opacity-50 animate-in fade-in zoom-in-95 duration-150"
                >
                  <svg
                    className="w-5 h-5 text-ink-secondary"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
                    />
                  </svg>
                </button>
              )}

              <button
                type="button"
                disabled={saving || hasParseError}
                onClick={() => {
                  if (hasParseError || cashSen === null || tngSen === null) {
                    setErrorMessage(t.invalidAmount);
                    return;
                  }
                  setShowConfirmModal(true);
                }}
                className="h-12 px-5 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm tracking-wide shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 focus-visible:ring-offset-1"
              >
                {saving ? (
                  <span>{t.saving}</span>
                ) : (
                  <span>{t.saveSheet}</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Delete Cost Line Confirmation Modal */}
      {pendingDeleteIndex !== null && costLines[pendingDeleteIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-cost-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDeleteIndex(null);
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
                <h3 id="confirm-delete-cost-title" className="text-base font-bold text-ink-primary">
                  {t.confirmDeleteItemTitle}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t.confirmDeleteItemDesc}
                </p>
              </div>
            </div>

            {/* Item detail snapshot */}
            <div className="p-3 rounded-xl bg-surface-subtle border border-surface-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-surface-border text-ink-secondary whitespace-nowrap">
                  {getCategoryLabel(costLines[pendingDeleteIndex].category)}
                </span>
                {costLines[pendingDeleteIndex].note && (
                  <span className="text-xs text-ink-muted truncate">
                    {costLines[pendingDeleteIndex].note}
                  </span>
                )}
              </div>
              <span className="text-base font-bold text-finance-loss whitespace-nowrap">
                {formatMyr(BigInt(costLines[pendingDeleteIndex].amountSen))}
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteIndex(null)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRemoveCostLine(pendingDeleteIndex);
                  setPendingDeleteIndex(null);
                }}
                className="flex-1 h-11 rounded-xl bg-finance-loss hover:bg-finance-loss/90 btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
              >
                {t.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Popout Modal */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirmModal(false);
          }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-surface-border space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-broccoli-light flex items-center justify-center text-xl shrink-0 select-none">
                🥦
              </div>
              <div className="min-w-0">
                <h3 id="confirm-modal-title" className="text-base font-bold text-ink-primary">
                  {t.confirmSaveTitle}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {date} ({t.klTime})
                </p>
              </div>
            </div>

            {/* Financial Summary of Today's Sheet */}
            <div className="p-3 rounded-xl bg-surface-subtle border border-surface-border space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">{t.totalRevenue}</span>
                <span className="font-bold text-ink-primary text-base">{totalRevenueSen !== null ? formatMyr(totalRevenueSen) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">{t.totalCosts}</span>
                <span className="font-bold text-finance-loss text-base">{formatMyr(totalCostSen)}</span>
              </div>
              <div className="pt-2 border-t border-surface-border flex items-center justify-between">
                <span className="font-semibold text-ink-primary">{t.grossProfit}</span>
                <span
                  className={`font-bold text-lg ${
                    grossProfitSen !== null && grossProfitSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
                  }`}
                >
                  {grossProfitSen !== null ? formatMyr(grossProfitSen) : "—"}
                </span>
              </div>
            </div>

            <p className="text-xs text-ink-muted">
              {t.confirmSaveDesc}
            </p>

            {/* Modal Actions */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={saving || hasParseError}
                onClick={() => {
                  setShowConfirmModal(false);
                  handleSave();
                }}
                className="flex-1 h-11 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
              >
                {saving ? (
                  <span>{t.saving}</span>
                ) : (
                  <span>{t.confirmSaveBtn}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
