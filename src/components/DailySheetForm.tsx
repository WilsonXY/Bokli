"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen } from "@/lib/money";

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

const CATEGORIES: Array<{
  key: CostLineItem["category"];
  zh: string;
  en: string;
  icon: string;
}> = [
  { key: "restock", zh: "进货", en: "Restock", icon: "🥬" },
  { key: "gas", zh: "煤气", en: "Gas", icon: "🔥" },
  { key: "transport", zh: "交通", en: "Transport", icon: "🛵" },
  { key: "wages-daily", zh: "每日工资", en: "Daily Wages", icon: "👥" },
  { key: "other", zh: "其他", en: "Other", icon: "📦" },
];

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
  const [isPending, startTransition] = useTransition();

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
      setErrorMessage("请输入有效的开销金额 (Please enter a valid amount)");
      return;
    }

    if (newCat === "other" && !newNote.trim()) {
      setErrorMessage("类别为'其他'时，必须填写备注说明 (Note is required when category is Other)");
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
        throw new Error(data.error || "保存失败 (Failed to save)");
      }

      setSuccessMessage("今日账单保存成功！(Daily Sheet saved successfully!)");
      setTimeout(() => setSuccessMessage(null), 4000);
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setErrorMessage(err.message || "网络或保存错误 (Network or save error)");
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

  return (
    <div className="space-y-5">
      {/* Date Bar & Lock Notice */}
      <div className="bg-white border border-surface-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            className="px-3 py-2 rounded-xl border border-surface-border hover:bg-surface-subtle text-xs font-semibold flex items-center gap-1 min-h-tap"
            title="前一天 (Previous Day)"
          >
            ← 前一天
          </button>

          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg font-extrabold text-ink-primary tracking-tight">
                {date}
              </span>
              {isToday && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-broccoli-light font-bold text-brand-broccoli">
                  今日 (Today)
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              吉隆坡时间 · Asia/Kuala_Lumpur
            </p>
          </div>

          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => navigateDate(1)}
            className="px-3 py-2 rounded-xl border border-surface-border hover:bg-surface-subtle text-xs font-semibold flex items-center gap-1 min-h-tap disabled:opacity-30 disabled:pointer-events-none"
            title="后一天 (Next Day)"
          >
            后一天 →
          </button>
        </div>

        {isClosed && (
          <div className="p-3 rounded-xl bg-status-closed-bg/60 border border-status-closed/20 flex items-center gap-2 text-xs font-bold text-status-closed">
            <span>🔒</span>
            <span>
              该月份已结账锁定，仅供查看，修改需由管理员重开 (Month closed — Read only)
            </span>
          </div>
        )}
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-semibold flex items-center justify-between">
          <span>⚠️ {errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-sm font-bold ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-xl bg-finance-profit-light border border-finance-profit-border text-xs text-brand-broccoli font-bold flex items-center gap-2">
          <span>✓</span>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Section 1: Revenue Entry */}
      <section aria-label="Revenue Entry" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-extrabold text-ink-primary flex items-center gap-2">
            <span>1. 营业收入 (Revenue)</span>
          </h2>
          <span className="text-xs font-bold text-ink-muted">
            合计: {formatMyr(totalRevenueSen)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Cash Revenue Card */}
          <div className="bg-white border-2 border-channel-cash/30 rounded-2xl p-4 shadow-sm relative overflow-hidden focus-within:border-channel-cash transition-all">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-channel-cash inline-block" />
                <label
                  htmlFor="cash-input"
                  className="text-xs font-bold text-ink-primary"
                >
                  现金收入 (Cash Revenue)
                </label>
              </div>
              <span className="text-[11px] font-semibold text-channel-cash bg-channel-cash-light px-2 py-0.5 rounded-md">
                纸币/硬币
              </span>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-3 text-lg font-bold text-ink-muted select-none">
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
                className="w-full h-14 pl-12 pr-3 rounded-xl bg-surface-canvas border border-surface-border text-2xl font-black text-ink-primary focus:outline-none focus:bg-white focus:border-channel-cash focus:ring-2 focus:ring-channel-cash-light disabled:opacity-60 transition-all"
              />
            </div>
          </div>

          {/* Touch 'n Go Revenue Card */}
          <div className="bg-white border-2 border-channel-tng/30 rounded-2xl p-4 shadow-sm relative overflow-hidden focus-within:border-channel-tng transition-all">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-channel-tng inline-block" />
                <label
                  htmlFor="tng-input"
                  className="text-xs font-bold text-ink-primary"
                >
                  TnG 收入 (TnG Revenue)
                </label>
              </div>
              <span className="text-[11px] font-semibold text-channel-tng bg-channel-tng-light px-2 py-0.5 rounded-md">
                电子钱包
              </span>
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-3 text-lg font-bold text-ink-muted select-none">
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
                className="w-full h-14 pl-12 pr-3 rounded-xl bg-surface-canvas border border-surface-border text-2xl font-black text-ink-primary focus:outline-none focus:bg-white focus:border-channel-tng focus:ring-2 focus:ring-channel-tng-light disabled:opacity-60 transition-all"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Itemized Daily Costs */}
      <section aria-label="Daily Costs Entry" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-extrabold text-ink-primary">
            2. 日常开销明细 (Daily Costs)
          </h2>
          <span className="text-xs font-bold text-finance-loss">
            总开销: {formatMyr(totalCostSen)}
          </span>
        </div>

        {/* Cost Line Entry Box */}
        {!isClosed && (
          <div className="bg-white border border-surface-border rounded-2xl p-4 shadow-sm space-y-3">
            <div>
              <span className="block text-xs font-bold text-ink-secondary mb-2">
                选择支出类别 (Cost Category)
              </span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => {
                  const isSelected = newCat === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setNewCat(cat.key)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all min-h-tap ${
                        isSelected
                          ? "bg-finance-cost text-white shadow-sm ring-2 ring-finance-cost-light"
                          : "bg-surface-subtle text-ink-secondary border border-surface-border hover:border-surface-border-strong"
                      }`}
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.zh}</span>
                      <span className="text-[10px] opacity-80">({cat.en})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-ink-secondary mb-1">
                  金额 (Amount)
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-sm font-bold text-ink-muted select-none">
                    RM
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-12 pl-11 pr-3 rounded-xl bg-surface-canvas border border-surface-border text-base font-bold text-ink-primary focus:outline-none focus:bg-white focus:border-finance-cost focus:ring-1 focus:ring-finance-cost"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-secondary mb-1">
                  备注 {newCat === "other" && <span className="text-finance-loss">*必填</span>} (Note)
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={newCat === "other" ? "说明具体开销内容 (Required)" : "可选备注 (Optional note)"}
                  className="w-full h-12 px-3 rounded-xl bg-surface-canvas border border-surface-border text-sm text-ink-primary focus:outline-none focus:bg-white focus:border-finance-cost focus:ring-1 focus:ring-finance-cost"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddCostLine}
              className="w-full h-12 rounded-xl border-2 border-dashed border-finance-cost text-finance-cost hover:bg-finance-cost-light/50 font-bold text-xs flex items-center justify-center gap-1.5 transition-all min-h-tap"
            >
              <span>+</span>
              <span>添加一条开销 (Add Cost Line)</span>
            </button>
          </div>
        )}

        {/* Existing Cost Lines List */}
        <div className="bg-white border border-surface-border rounded-2xl p-4 shadow-sm">
          {costLines.length === 0 ? (
            <div className="text-center py-6 text-xs text-ink-muted">
              今日暂无开销记录 (No cost lines added for today)
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {costLines.map((line, idx) => {
                const catMeta =
                  CATEGORIES.find((c) => c.key === line.category) ?? {
                    zh: line.category,
                    en: line.category,
                    icon: "📌",
                  };
                return (
                  <div
                    key={line.id ?? `temp-${idx}`}
                    className="py-3 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl select-none">{catMeta.icon}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-ink-primary flex items-center gap-1.5">
                          <span>{catMeta.zh}</span>
                          <span className="text-[10px] text-ink-muted">
                            ({catMeta.en})
                          </span>
                        </div>
                        {line.note && (
                          <div className="text-[11px] text-ink-muted truncate">
                            {line.note}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-finance-loss whitespace-nowrap">
                        {formatMyr(BigInt(line.amountSen))}
                      </span>
                      {!isClosed && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCostLine(idx)}
                          className="w-8 h-8 rounded-lg hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center text-base font-bold min-h-tap min-w-tap transition-colors"
                          title="删除 (Delete)"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Sticky Bottom Action Bar */}
      <div className="sticky bottom-16 z-30 bg-white/95 backdrop-blur-md border border-surface-border rounded-2xl p-3.5 shadow-md flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-ink-muted font-medium">
            当日毛利润 (Day's Gross Profit)
          </div>
          <div
            className={`text-xl font-black ${
              grossProfitSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
            }`}
          >
            {formatMyr(grossProfitSen)}
          </div>
        </div>

        {!isClosed && (
          <button
            type="button"
            disabled={saving || isPending}
            onClick={handleSave}
            className="px-5 h-12 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark text-white font-extrabold text-sm tracking-wide shadow-sm flex items-center gap-2 min-h-tap transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? (
              <span>保存中...</span>
            ) : (
              <>
                <span>保存账单 (Save Sheet)</span>
                <span>✓</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
