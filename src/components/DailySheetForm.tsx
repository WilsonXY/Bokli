"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n } from "@/lib/i18n";
import { CalendarPopover } from "@/components/CalendarPopover";

export interface CostLineItem {
  id?: number;
  category: "restock" | "gas" | "transport" | "wages-daily" | "other";
  amountSen: number;
  note?: string | null;
}

interface DailySheetFormProps {
  date: string;
  initialCashSen: number;
  initialTngSen: number;
  initialCostLines: CostLineItem[];
  isClosed: boolean;
  todayKl: string;
}

function senToDecimalStr(sen: number): string {
  if (!sen) return "";
  const ringgit = Math.floor(sen / 100);
  const cents = (sen % 100).toString().padStart(2, "0");
  return cents === "00" ? `${ringgit}` : `${ringgit}.${cents}`;
}

export function DailySheetForm({
  date,
  initialCashSen,
  initialTngSen,
  initialCostLines,
  isClosed,
  todayKl,
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
    { key: "other", label: t.catOther },
  ];

  // Calendar popover toggle state & trigger ref
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  // Revenue inputs state
  const [cashInput, setCashInput] = useState(senToDecimalStr(initialCashSen));
  const [tngInput, setTngInput] = useState(senToDecimalStr(initialTngSen));

  // Cost lines state
  const [costLines, setCostLines] = useState<CostLineItem[]>(initialCostLines);

  // New cost line draft
  const [newCat, setNewCat] = useState<CostLineItem["category"]>("restock");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");

  // Feedback states
  const [costLineError, setCostLineError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Safe parsing helper
  function toSen(val: string): bigint {
    const s = val.trim();
    if (!s || s === ".") return 0n;
    try {
      const normalized = s.startsWith(".") ? `0${s}` : s;
      return parseSen(normalized);
    } catch {
      return 0n;
    }
  }

  const cashSen = toSen(cashInput);
  const tngSen = toSen(tngInput);
  const totalRevenueSen = cashSen + tngSen;

  const totalCostSen = costLines.reduce(
    (acc, line) => acc + BigInt(line.amountSen),
    0n,
  );

  const grossProfitSen = totalRevenueSen - totalCostSen;

  // Add Cost Line
  function handleAddCostLine() {
    setCostLineError(null);
    const amountVal = toSen(newAmount);

    if (amountVal <= 0n) {
      setCostLineError(t.invalidAmount);
      return;
    }

    if (newCat === "other" && !newNote.trim()) {
      setCostLineError(t.otherNoteRequired);
      return;
    }

    const newLine: CostLineItem = {
      category: newCat,
      amountSen: Number(amountVal),
      note: newNote.trim() || null,
    };

    setCostLines((prev) => [...prev, newLine]);
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
    if (isClosed) return;
    setErrorMessage(null);
    setCostLineError(null);
    setSuccessMessage(null);

    // Validate revenue inputs if entered
    if (cashInput.trim() && cashInput.trim() !== ".") {
      try {
        const norm = cashInput.trim().startsWith(".") ? `0${cashInput.trim()}` : cashInput.trim();
        parseSen(norm);
      } catch {
        setErrorMessage(t.invalidAmount);
        return;
      }
    }
    if (tngInput.trim() && tngInput.trim() !== ".") {
      try {
        const norm = tngInput.trim().startsWith(".") ? `0${tngInput.trim()}` : tngInput.trim();
        parseSen(norm);
      } catch {
        setErrorMessage(t.invalidAmount);
        return;
      }
    }

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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t.saveError);
      }

      setSuccessMessage(t.saveSuccess);
      setTimeout(() => setSuccessMessage(null), 3500);
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setErrorMessage(err.message || t.saveError);
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
            className="w-11 h-11 shrink-0 rounded-lg border border-surface-border hover:bg-surface-subtle text-sm font-semibold flex items-center justify-center gap-1 transition-colors sm:w-auto sm:px-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            <span aria-hidden="true" className="text-base">←</span>
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
            className="w-11 h-11 shrink-0 rounded-lg border border-surface-border hover:bg-surface-subtle text-sm font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-30 disabled:pointer-events-none sm:w-auto sm:px-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            <span className="hidden sm:inline whitespace-nowrap">{t.nextDay}</span>
            <span aria-hidden="true" className="text-base">→</span>
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

      {/* Global Sheet Notifications (Save Errors / Confirmations) */}
      {errorMessage && (
        <div className="py-2 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between">
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

      {successMessage && (
        <div className="py-2 px-3 rounded-lg bg-finance-profit-light border border-finance-profit-border text-sm text-brand-broccoli font-semibold flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Section 1: Revenue Entry */}
      <section aria-label="Revenue Entry" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.revenueTitle}
          </h2>
          <span className="text-sm font-medium text-ink-muted">
            {t.totalRevenue}: <span className="font-semibold text-ink-primary">{formatMyr(totalRevenueSen)}</span>
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
                className="w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-lg font-bold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-cash focus-visible:ring-2 focus-visible:ring-channel-cash/50 disabled:opacity-60 transition-colors"
              />
            </div>
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
                className="w-full h-12 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-lg font-bold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-tng focus-visible:ring-2 focus-visible:ring-channel-tng/50 disabled:opacity-60 transition-colors"
              />
            </div>
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
                      className={`min-h-[44px] px-3.5 py-2.5 rounded-lg text-sm font-semibold border transition-colors select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 ${
                        isSelected
                          ? "bg-ink-primary text-white border-ink-primary shadow-xs"
                          : "bg-surface-subtle text-ink-secondary border-surface-border hover:border-surface-border-strong hover:bg-surface-subtle/80"
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
              className="w-full h-11 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark text-white font-semibold text-sm flex items-center justify-center transition-all shadow-xs active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
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
                  key={line.id ?? `temp-${idx}`}
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
                        onClick={() => handleRemoveCostLine(idx)}
                        aria-label={t.delete}
                        className="w-11 h-11 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60"
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

      {/* Sticky Bottom Action Bar */}
      <div className="sticky bottom-16 z-30 bg-white/95 backdrop-blur-md border border-surface-border rounded-xl p-3 shadow-sm flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-ink-muted font-medium">
            {t.grossProfit}
          </div>
          <div
            className={`text-xl font-bold ${
              grossProfitSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
            }`}
          >
            {formatMyr(grossProfitSen)}
          </div>
        </div>

        {!isClosed && (
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="h-12 px-5 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark text-white font-semibold text-sm tracking-wide shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 focus-visible:ring-offset-1"
          >
            {saving ? (
              <span>{t.saving}</span>
            ) : (
              <span>{t.saveSheet}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
