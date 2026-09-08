"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setErrorMessage(null);
    const amountVal = toSen(newAmount);

    if (amountVal <= 0n) {
      setErrorMessage(t.invalidAmount);
      return;
    }

    if (newCat === "other" && !newNote.trim()) {
      setErrorMessage(t.otherNoteRequired);
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
      {/* Date Bar with Direct Date Picker Trigger & Lock Notice */}
      <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            className="h-8 px-2.5 rounded-lg border border-surface-border hover:bg-surface-subtle text-xs font-medium flex items-center gap-1 transition-colors"
          >
            ← {t.prevDay}
          </button>

          {/* Clickable Date Selector with Native Date Picker Overlay */}
          <div className="relative text-center group cursor-pointer px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors">
            <input
              type="date"
              value={date}
              max={todayKl}
              onChange={(e) => {
                if (e.target.value && e.target.value <= todayKl) {
                  router.push(`/?date=${e.target.value}`);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              title="点击选择日期 (Click to pick date)"
            />
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-sm font-bold text-ink-primary group-hover:text-brand-broccoli transition-colors">
                {date}
              </span>
              <svg
                className="w-3.5 h-3.5 text-ink-muted group-hover:text-brand-broccoli transition-colors"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {isToday && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-brand-broccoli-light font-semibold text-brand-broccoli">
                  {t.today}
                </span>
              )}
            </div>
            <p className="text-[10px] text-ink-muted">
              {t.klTime}
            </p>
          </div>

          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => navigateDate(1)}
            className="h-8 px-2.5 rounded-lg border border-surface-border hover:bg-surface-subtle text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            {t.nextDay} →
          </button>
        </div>

        {isClosed && (
          <div className="py-2 px-3 rounded-lg bg-status-closed-bg/60 border border-status-closed/20 flex items-center gap-2 text-xs font-medium text-status-closed">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>{t.monthLocked}</span>
          </div>
        )}
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="py-2 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between">
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
        <div className="py-2 px-3 rounded-lg bg-finance-profit-light border border-finance-profit-border text-xs text-brand-broccoli font-semibold flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Section 1: Revenue Entry */}
      <section aria-label="Revenue Entry" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-xs font-bold text-ink-secondary uppercase tracking-wider">
            {t.revenueTitle}
          </h2>
          <span className="text-xs font-medium text-ink-muted">
            {t.totalRevenue}: <span className="font-semibold text-ink-primary">{formatMyr(totalRevenueSen)}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Cash Revenue Card */}
          <div className="bg-white border border-surface-border border-l-4 border-l-channel-cash rounded-xl p-3 shadow-xs focus-within:border-channel-cash transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-channel-cash inline-block shrink-0" />
              <label
                htmlFor="cash-input"
                className="text-xs font-semibold text-ink-primary"
              >
                {t.cashRevenue}
              </label>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-xs font-bold text-channel-cash select-none">
                RM
              </span>
              <input
                id="cash-input"
                type="text"
                inputMode="decimal"
                disabled={isClosed}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-base font-semibold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-cash disabled:opacity-60 transition-colors"
              />
            </div>
          </div>

          {/* Touch 'n Go Revenue Card */}
          <div className="bg-white border border-surface-border border-l-4 border-l-channel-tng rounded-xl p-3 shadow-xs focus-within:border-channel-tng transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-channel-tng inline-block shrink-0" />
              <label
                htmlFor="tng-input"
                className="text-xs font-semibold text-ink-primary"
              >
                {t.tngRevenue}
              </label>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-xs font-bold text-channel-tng select-none">
                RM
              </span>
              <input
                id="tng-input"
                type="text"
                inputMode="decimal"
                disabled={isClosed}
                value={tngInput}
                onChange={(e) => setTngInput(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-base font-semibold text-ink-primary focus:outline-none focus:bg-white focus:border-channel-tng disabled:opacity-60 transition-colors"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Itemized Daily Costs */}
      <section aria-label="Daily Costs Entry" className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-xs font-bold text-ink-secondary uppercase tracking-wider">
            {t.costsTitle}
          </h2>
          <span className="text-xs font-medium text-ink-muted">
            {t.totalCosts}: <span className="font-semibold text-finance-loss">{formatMyr(totalCostSen)}</span>
          </span>
        </div>

        {/* Cost Line Entry Box - Clean Neutral Dark / Slate for Discipline (No Orange) */}
        {!isClosed && (
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs space-y-2.5">
            <div>
              <span className="block text-[11px] font-medium text-ink-muted mb-1.5">
                {t.selectCategory}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const isSelected = newCat === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setNewCat(cat.key)}
                      className={`h-7 px-2.5 rounded-md text-xs font-medium transition-all ${
                        isSelected
                          ? "bg-ink-primary text-white shadow-xs font-semibold"
                          : "bg-surface-subtle text-ink-secondary border border-surface-border hover:border-surface-border-strong"
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
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  {t.amount}
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-xs font-semibold text-ink-muted select-none">
                    RM
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-9 pl-9 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-sm font-medium text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  {t.note} {newCat === "other" && <span className="text-finance-loss">({t.noteRequiredBadge})</span>}
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={newCat === "other" ? t.noteRequired : t.noteOptional}
                  className="w-full h-9 px-2.5 rounded-lg bg-surface-canvas border border-surface-border text-xs text-ink-primary focus:outline-none focus:bg-white focus:border-ink-primary"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddCostLine}
              className="w-full h-8 rounded-lg border border-dashed border-surface-border-strong text-ink-primary hover:bg-surface-subtle font-medium text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <span>+</span>
              <span>{t.addCostLine}</span>
            </button>
          </div>
        )}

        {/* Existing Cost Lines List */}
        <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs">
          {costLines.length === 0 ? (
            <div className="text-center py-4 text-xs text-ink-muted">
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
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary whitespace-nowrap">
                      {getCategoryLabel(line.category)}
                    </span>
                    {line.note && (
                      <span className="text-xs text-ink-muted truncate">
                        {line.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-finance-loss whitespace-nowrap">
                      {formatMyr(BigInt(line.amountSen))}
                    </span>
                    {!isClosed && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCostLine(idx)}
                        className="w-6 h-6 rounded hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-xs transition-colors"
                        title={t.delete}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
          <div className="text-[10px] text-ink-muted font-medium">
            {t.grossProfit}
          </div>
          <div
            className={`text-base font-bold ${
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
            className="h-9 px-4 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark text-white font-semibold text-xs tracking-wide shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-[0.98]"
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
