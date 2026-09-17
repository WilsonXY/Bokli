"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amountSizeClass, formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError } from "@/lib/i18n";
import { CalendarPopover } from "@/components/CalendarPopover";
import type { CostCategory } from "@/services/daily-sheet";
import type { CostLine } from "@/db/schema";

export interface CostLineItem {
  id?: number;
  ids?: number[];
  category: CostCategory;
  amountSen: number;
  note?: string | null;
  clientId?: string;
  amountInput?: string;
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
  initialNoteErrorIndex?: number | null;
  initialCostAmountErrorIndex?: number | null;
  initialErrorMessage?: string | null;
  initialExpandedIndex?: number | null;
}

const MAX_SAFE_SEN = Number.MAX_SAFE_INTEGER; // 9007199254740991

export function normalizeNote(note?: unknown): string {
  if (typeof note !== "string") {
    return "";
  }
  return note.trim();
}

// Save-gate helper: index of the first "other"-category line missing its
// required note, or -1. Used by handleSave to block the request client-side.
export function findMissingOtherNoteIndex(
  lines: Pick<CostLineItem, "category" | "note">[]
): number {
  return lines.findIndex(
    (line) => line.category === "other" && !normalizeNote(line.note)
  );
}

// Save-gate helper: index of the first cost line with zero or non-positive amount,
// or -1. Used to block save and display inline invalid-amount error under that row.
export function findZeroCostLineIndex(
  lines: Pick<CostLineItem, "amountSen">[]
): number {
  return lines.findIndex((line) => line.amountSen <= 0);
}

export function areIdsEqual(a?: number[], b?: number[]): boolean {
  const listA = a ?? [];
  const listB = b ?? [];
  if (listA.length !== listB.length) return false;
  const sortedA = [...listA].sort((x, y) => x - y);
  const sortedB = [...listB].sort((x, y) => x - y);
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

export function getCostLineKey(line: CostLineItem, fallbackIndex?: number): string {
  if (line.id !== undefined) return `cost-line-${line.id}`;
  if (line.ids && line.ids.length > 0) return `cost-line-${line.ids.slice().sort((a, b) => a - b).join("-")}`;
  if (line.clientId) return `cost-line-${line.clientId}`;
  const norm = normalizeNote(line.note);
  if (norm) return `cost-line-${line.category}-${norm}`;
  return `cost-line-${line.category}-${fallbackIndex ?? "new"}`;
}

export function mergeCostLines(lines: CostLineItem[]): CostLineItem[] {
  const merged: CostLineItem[] = [];
  for (const line of lines) {
    const normNote = normalizeNote(line.note);
    const existingIndex = merged.findIndex(
      (m) => m.category === line.category && normalizeNote(m.note) === normNote
    );
    const lineIds: number[] = [
      ...(line.ids ?? []),
      ...(line.id !== undefined && (!line.ids || !line.ids.includes(line.id)) ? [line.id] : []),
    ];

    if (existingIndex !== -1) {
      const existing = merged[existingIndex];
      const combinedIds = [...(existing.ids ?? []), ...lineIds];
      const mergedTotal = existing.amountSen + line.amountSen;
      const safeAmount =
        Number.isSafeInteger(mergedTotal) && mergedTotal >= 0 && mergedTotal <= MAX_SAFE_SEN
          ? mergedTotal
          : MAX_SAFE_SEN;
      merged[existingIndex] = {
        category: existing.category,
        note: existing.note,
        amountSen: safeAmount,
        amountInput: safeAmount > 0 ? senToDecimalStr(safeAmount) : "",
        ids: combinedIds,
        clientId: existing.clientId,
      };
    } else {
      const safeAmount =
        Number.isSafeInteger(line.amountSen) && line.amountSen >= 0 && line.amountSen <= MAX_SAFE_SEN
          ? line.amountSen
          : Math.min(Math.max(0, line.amountSen), MAX_SAFE_SEN);
      merged.push({
        category: line.category,
        note: normNote || null,
        amountSen: safeAmount,
        amountInput: line.amountInput ?? (safeAmount > 0 ? senToDecimalStr(safeAmount) : ""),
        ids: lineIds,
        clientId: line.clientId,
      });
    }
  }
  return merged;
}

export function appendOrMergeCostLine(
  prev: CostLineItem[],
  newCat: CostCategory,
  amountVal: number,
  normNote: string | null,
): { lines: CostLineItem[]; error?: string } {
  const existingIndex = prev.findIndex(
    (l) => l.category === newCat && normalizeNote(l.note) === normalizeNote(normNote)
  );

  if (existingIndex !== -1) {
    const existing = prev[existingIndex];
    const mergedTotal = existing.amountSen + amountVal;
    if (mergedTotal > MAX_SAFE_SEN) {
      return { lines: prev, error: "invalidAmount" };
    }
    const safeAmount =
      Number.isSafeInteger(mergedTotal) && mergedTotal >= 0 && mergedTotal <= MAX_SAFE_SEN
        ? mergedTotal
        : MAX_SAFE_SEN;
    const updated = prev.map((line, idx) =>
      idx === existingIndex
        ? {
            category: line.category,
            note: line.note,
            amountSen: safeAmount,
            amountInput: safeAmount > 0 ? senToDecimalStr(safeAmount) : "",
            ids: line.ids ?? (line.id !== undefined ? [line.id] : []),
            clientId: line.clientId,
          }
        : line
    );
    return { lines: updated };
  }

  return {
    lines: [
      ...prev,
      {
        category: newCat,
        amountSen: amountVal,
        amountInput: amountVal > 0 ? senToDecimalStr(amountVal) : "",
        note: normNote,
        ids: [],
      },
    ],
  };
}

function senToDecimalStr(sen: number): string {
  if (!sen) return "";
  const ringgit = Math.floor(sen / 100);
  const cents = (sen % 100).toString().padStart(2, "0");
  return cents === "00" ? `${ringgit}` : `${ringgit}.${cents}`;
}

function extractCostLineIds(line: CostLineItem): number[] {
  return [
    ...(line.ids ?? []),
    ...(line.id !== undefined && (!line.ids || !line.ids.includes(line.id)) ? [line.id] : []),
  ];
}

export function consolidateCostLines(lines: CostLineItem[]): CostLineItem[] {
  const firstSeen = new Map<string, number>();
  const result: CostLineItem[] = [];

  for (const line of lines) {
    if (line.amountSen <= 0) {
      result.push(line);
      continue;
    }

    const key = `${line.category}::${normalizeNote(line.note)}`;
    const targetIdx = firstSeen.get(key);

    if (targetIdx !== undefined) {
      const target = result[targetIdx];
      const mergedTotal = target.amountSen + line.amountSen;
      const safeAmount =
        Number.isSafeInteger(mergedTotal) && mergedTotal >= 0 && mergedTotal <= MAX_SAFE_SEN
          ? mergedTotal
          : MAX_SAFE_SEN;

      const targetIds = extractCostLineIds(target);
      const incomingIds = extractCostLineIds(line);
      const combinedIds = [...targetIds, ...incomingIds.filter((id) => !targetIds.includes(id))];

      result[targetIdx] = {
        category: target.category,
        note: target.note,
        amountSen: safeAmount,
        amountInput: safeAmount > 0 ? senToDecimalStr(safeAmount) : "",
        ids: combinedIds,
        clientId: target.clientId,
      };
    } else {
      firstSeen.set(key, result.length);
      result.push(line);
    }
  }

  return result;
}

export function createNewCostLine(
  costLines: CostLineItem[],
  newLineFactory?: () => CostLineItem
): { lines: CostLineItem[]; expandedIndex: number } {
  // (1) consolidate existing lines as today
  const consolidated = consolidateCostLines(costLines);
  // (2) REMOVE any cost line with amountSen <= 0 (the unfilled one)
  const filledOnly = consolidated.filter((line) => line.amountSen > 0);
  // (3) append one fresh empty row and expand it
  const newLine: CostLineItem = newLineFactory
    ? newLineFactory()
    : {
        clientId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        category: "restock",
        amountSen: 0,
        amountInput: "",
        note: "",
        ids: [],
      };
  return {
    lines: [...filledOnly, newLine],
    expandedIndex: filledOnly.length,
  };
}

export function findConsolidatedLineIndex(
  targetLine: CostLineItem,
  consolidated: CostLineItem[]
): number {
  if (targetLine.clientId) {
    const idx = consolidated.findIndex((l) => l.clientId === targetLine.clientId);
    if (idx !== -1) return idx;
  }

  const refIdx = consolidated.indexOf(targetLine);
  if (refIdx !== -1) return refIdx;

  if (targetLine.id !== undefined) {
    const idIdx = consolidated.findIndex((l) => l.id === targetLine.id);
    if (idIdx !== -1) return idIdx;
  }

  if (targetLine.amountSen > 0) {
    if (targetLine.id !== undefined) {
      const mergedWithIdIdx = consolidated.findIndex(
        (l) => l.ids && l.ids.includes(targetLine.id!)
      );
      if (mergedWithIdIdx !== -1) return mergedWithIdIdx;
    }
    if (targetLine.ids && targetLine.ids.length > 0) {
      const mergedWithIdsIdx = consolidated.findIndex(
        (l) => l.ids && l.ids.some((id) => targetLine.ids!.includes(id))
      );
      if (mergedWithIdsIdx !== -1) return mergedWithIdsIdx;
    }

    const norm = normalizeNote(targetLine.note);
    const keyIdx = consolidated.findIndex(
      (l) =>
        l.amountSen > 0 &&
        l.category === targetLine.category &&
        normalizeNote(l.note) === norm
    );
    if (keyIdx !== -1) return keyIdx;
  }

  return consolidated.findIndex(
    (l) =>
      l.category === targetLine.category &&
      l.amountSen === targetLine.amountSen &&
      normalizeNote(l.note) === normalizeNote(targetLine.note)
  );
}

export function toggleCostLineExpansion(
  lines: CostLineItem[],
  clickedIndex: number,
  currentExpandedIndex: number | null,
  options?: {
    noteErrorIndex?: number | null;
    costAmountErrorIndex?: number | null;
  }
): {
  lines: CostLineItem[];
  expandedIndex: number | null;
  noteErrorIndex: number | null;
  costAmountErrorIndex: number | null;
} {
  const clickedLine = lines[clickedIndex];
  if (!clickedLine) {
    return {
      lines,
      expandedIndex: currentExpandedIndex,
      noteErrorIndex: options?.noteErrorIndex ?? null,
      costAmountErrorIndex: options?.costAmountErrorIndex ?? null,
    };
  }

  const consolidated = consolidateCostLines(lines);

  let noteErrorIndex: number | null = null;
  if (options?.noteErrorIndex !== undefined && options.noteErrorIndex !== null) {
    const errLine = lines[options.noteErrorIndex];
    if (errLine) {
      const newIdx = findConsolidatedLineIndex(errLine, consolidated);
      if (
        newIdx !== -1 &&
        consolidated[newIdx].category === "other" &&
        !normalizeNote(consolidated[newIdx].note)
      ) {
        noteErrorIndex = newIdx;
      }
    }
  }

  let costAmountErrorIndex: number | null = null;
  if (options?.costAmountErrorIndex !== undefined && options.costAmountErrorIndex !== null) {
    const errLine = lines[options.costAmountErrorIndex];
    if (errLine) {
      const newIdx = findConsolidatedLineIndex(errLine, consolidated);
      if (newIdx !== -1 && consolidated[newIdx].amountSen <= 0) {
        costAmountErrorIndex = newIdx;
      }
    }
  }

  const wasMergedAway =
    clickedLine.amountSen > 0 &&
    lines.slice(0, clickedIndex).some(
      (l) =>
        l.amountSen > 0 &&
        l.category === clickedLine.category &&
        normalizeNote(l.note) === normalizeNote(clickedLine.note)
    );

  const targetIdx = findConsolidatedLineIndex(clickedLine, consolidated);

  let nextExpandedIndex: number | null;
  if (wasMergedAway) {
    nextExpandedIndex = targetIdx !== -1 ? targetIdx : null;
  } else {
    const wasExpanded = currentExpandedIndex === clickedIndex;
    nextExpandedIndex = wasExpanded ? null : (targetIdx !== -1 ? targetIdx : null);
  }

  return {
    lines: consolidated,
    expandedIndex: nextExpandedIndex,
    noteErrorIndex,
    costAmountErrorIndex,
  };
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
  initialNoteErrorIndex = null,
  initialCostAmountErrorIndex = null,
  initialErrorMessage = null,
  initialExpandedIndex,
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

  // Cost lines state - merged on frontend if same category and same note
  const [costLines, setCostLines] = useState<CostLineItem[]>(() =>
    mergeCostLines(initialCostLines)
  );

  // Feedback states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(() => {
    if (initialExpandedIndex !== undefined) {
      return initialExpandedIndex;
    }
    if (initialCostAmountErrorIndex !== null && initialCostAmountErrorIndex !== undefined) {
      return initialCostAmountErrorIndex;
    }
    if (initialNoteErrorIndex !== null && initialNoteErrorIndex !== undefined) {
      return initialNoteErrorIndex;
    }
    const merged = mergeCostLines(initialCostLines);
    const zeroIdx = merged.findIndex((l) => l.amountSen === 0);
    return zeroIdx !== -1 ? zeroIdx : (merged.length === 1 ? 0 : null);
  });

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
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [noteErrorIndex, setNoteErrorIndex] = useState<number | null>(initialNoteErrorIndex);
  const [costAmountErrorIndex, setCostAmountErrorIndex] = useState<number | null>(initialCostAmountErrorIndex);
  const noteErrorRef = useRef<HTMLInputElement | null>(null);
  const costAmountErrorRef = useRef<HTMLInputElement | null>(null);

  // Focus the offending note input when the save gate flags a missing note
  useEffect(() => {
    if (noteErrorIndex !== null) {
      noteErrorRef.current?.focus();
    }
  }, [noteErrorIndex]);

  // Focus the offending amount input when the save gate flags a zero cost line
  useEffect(() => {
    if (costAmountErrorIndex !== null) {
      costAmountErrorRef.current?.focus();
    }
  }, [costAmountErrorIndex]);
  const [saving, setSaving] = useState(false);

  // Baseline state representing the saved/initial state for the selected date
  const [baseline, setBaseline] = useState(() => ({
    cashInput: initCashStr,
    tngInput: initTngStr,
    costLines: mergeCostLines(initialCostLines),
  }));

  // Check if current form inputs differ from baseline
  const isModified = useMemo(() => {
    if (cashInput.trim() !== baseline.cashInput.trim()) return true;
    if (tngInput.trim() !== baseline.tngInput.trim()) return true;
    if (costLines.length !== baseline.costLines.length) return true;

    for (let i = 0; i < costLines.length; i++) {
      const curr = costLines[i];
      const base = baseline.costLines[i];
      if (
        !base ||
        curr.category !== base.category ||
        curr.amountSen !== base.amountSen ||
        normalizeNote(curr.note) !== normalizeNote(base.note) ||
        !areIdsEqual(curr.ids, base.ids)
      ) {
        return true;
      }
    }
    return false;
  }, [cashInput, tngInput, costLines, baseline]);

  // Update form inputs when selected date or initial data changes
  useEffect(() => {
    const cashStr = initialCashInput !== undefined ? initialCashInput : senToDecimalStr(initialCashSen);
    const tngStr = initialTngInput !== undefined ? initialTngInput : senToDecimalStr(initialTngSen);
    const mergedInitial = mergeCostLines(initialCostLines);
    setCashInput(cashStr);
    setTngInput(tngStr);
    setCostLines(mergedInitial);
    setBaseline({
      cashInput: cashStr,
      tngInput: tngStr,
      costLines: mergedInitial,
    });
    const zeroIdx = mergedInitial.findIndex((l) => l.amountSen === 0);
    setExpandedIndex(zeroIdx !== -1 ? zeroIdx : (mergedInitial.length === 1 ? 0 : null));
    setErrorMessage(null);
  }, [date, initialCashSen, initialTngSen, initialCashInput, initialTngInput, initialCostLines]);

  // Revert modifications back to baseline
  function handleRevert() {
    setCashInput(baseline.cashInput);
    setTngInput(baseline.tngInput);
    setCostLines(baseline.costLines);
    setErrorMessage(null);
    setNoteErrorIndex(null);
    setCostAmountErrorIndex(null);
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
  const hasZeroCostLine = costLines.some((line) => line.amountSen <= 0);

  const grossProfitSen =
    totalRevenueSen !== null ? totalRevenueSen - totalCostSen : null;

  // Create and expand a new empty cost line with stable clientId
  function handleCreateNewCostLine() {
    if (isClosed) return;
    setNoteErrorIndex(null);
    setCostAmountErrorIndex(null);
    const result = createNewCostLine(costLines);
    setCostLines(result.lines);
    setExpandedIndex(result.expandedIndex);
  }

  // Update a specific cost line in place
  function handleUpdateCostLine(
    index: number,
    patch: Partial<CostLineItem>
  ) {
    if (
      (patch.note !== undefined && index === noteErrorIndex) ||
      (patch.category !== undefined && patch.category !== "other" && index === noteErrorIndex)
    ) {
      setNoteErrorIndex(null);
    }
    if (
      (patch.amountSen !== undefined || patch.amountInput !== undefined) &&
      index === costAmountErrorIndex
    ) {
      setCostAmountErrorIndex(null);
    }
    setExpandedIndex(index);
    setCostLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  // Remove Cost Line
  function handleRemoveCostLine(index: number) {
    if (isClosed) return;
    setNoteErrorIndex(null);
    setCostAmountErrorIndex(null);
    setCostLines((prev) => prev.filter((_, i) => i !== index));
    setExpandedIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  }

  function handleToggleCostLine(index: number) {
    if (isClosed) return;
    const result = toggleCostLineExpansion(costLines, index, expandedIndex, {
      noteErrorIndex,
      costAmountErrorIndex,
    });
    setCostLines(result.lines);
    setExpandedIndex(result.expandedIndex);
    setNoteErrorIndex(result.noteErrorIndex);
    setCostAmountErrorIndex(result.costAmountErrorIndex);
  }



  // Save full sheet
  async function handleSave() {
    if (saving) return;
    if (isClosed) return;
    if (hasParseError || cashSen === null || tngSen === null) {
      setErrorMessage(t.invalidAmount);
      return;
    }
    const consolidated = consolidateCostLines(costLines);
    setCostLines(consolidated);

    const zeroCostLineIdx = findZeroCostLineIndex(consolidated);
    if (zeroCostLineIdx !== -1) {
      setExpandedIndex(zeroCostLineIdx);
      setCostAmountErrorIndex(zeroCostLineIdx);
      setNoteErrorIndex(null);
      setErrorMessage(null);
      requestAnimationFrame(() => costAmountErrorRef.current?.focus());
      return;
    }
    setCostAmountErrorIndex(null);

    const missingNoteIdx = findMissingOtherNoteIndex(consolidated);
    if (missingNoteIdx !== -1) {
      setExpandedIndex(missingNoteIdx);
      setNoteErrorIndex(missingNoteIdx);
      setErrorMessage(null);
      // Re-focus even if the same line was already flagged (effect won't refire)
      requestAnimationFrame(() => noteErrorRef.current?.focus());
      return;
    }
    setNoteErrorIndex(null);
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
          costLines: consolidated
            .filter((l) => l.amountSen > 0)
            .map((l) => ({
              category: l.category,
              amountSen: l.amountSen,
              note: (l.note || "").trim() || undefined,
            })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(translateApiError(data.error, t));
      }

      if (data.sheet && Array.isArray(data.costLines)) {
        const savedCostLines: CostLineItem[] = mergeCostLines(
          data.costLines.map((l: CostLine) => ({
            id: l.id,
            category: l.category as CostCategory,
            amountSen: Number(l.amountSen),
            note: l.note || undefined,
          }))
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
    const targetDate = current.toISOString().slice(0, 10);
    router.push(`/?date=${targetDate}`);
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
          <h2 className="text-base font-bold text-ink-secondary uppercase tracking-wider">
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

          {/* TnG Revenue Card */}
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
      <section aria-label="Daily Costs Entry" className="space-y-2.5">
        <div className="pt-2 pb-0.5" aria-hidden="true">
          <hr className="border-t border-surface-border" />
        </div>
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-base font-bold text-ink-secondary uppercase tracking-wider">
            {t.costsTitle}
          </h2>
          <span className="sr-only">{t.costCategory}</span>
          <span className="text-sm font-medium text-ink-muted">
            {t.totalCosts}: <span className="font-semibold text-ink-primary">{formatMyr(totalCostSen)}</span>
          </span>
        </div>

        {/* Dynamic Cost Lines (Each line has its own summary + form) */}
        {costLines.length > 0 && (
          <div className="space-y-2">
            {costLines.map((line, idx) => {
              const isExpanded = expandedIndex === idx;
              return (
                <div
                  key={getCostLineKey(line, idx)}
                  className={`bg-white border rounded-xl shadow-xs transition-all overflow-hidden ${
                        isExpanded
                          ? "border-brand-broccoli ring-2 ring-brand-broccoli/20"
                          : "border-surface-border hover:border-slate-300"
                      }`}
                    >
                  {/* Summary Row */}
                      <div
                        onClick={() => {
                          if (isClosed) return;
                          handleToggleCostLine(idx);
                        }}
                        role="button"
                        tabIndex={isClosed ? -1 : 0}
                        aria-expanded={isExpanded}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (!isClosed) handleToggleCostLine(idx);
                          }
                        }}
                        className={`w-full px-4 py-3 flex items-center justify-between gap-2 select-none bg-white transition-colors ${
                          isClosed ? "cursor-default" : "cursor-pointer hover:bg-surface-subtle/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-5 h-5 flex items-center justify-center text-slate-400 shrink-0">
                            <svg
                              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-ink-secondary whitespace-nowrap">
                            {getCategoryLabel(line.category)}
                          </span>
                          {line.note && (
                            <span className="text-sm text-ink-primary font-medium truncate">
                              {line.note}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <span
                            className={`text-base font-bold text-slate-700 tabular-nums whitespace-nowrap ${amountSizeClass(
                              formatMyr(BigInt(line.amountSen))
                            )}`.trimEnd()}
                          >
                            {formatMyr(BigInt(line.amountSen))}
                          </span>

                          {!isClosed && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteIndex(idx);
                              }}
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

                  {/* Expanded Form Body */}
                      {isExpanded && !isClosed && (
                        <div className="p-4 border-t border-surface-border bg-surface-canvas/30 space-y-3">
                          {/* Category Selection */}
                          <div>
                            <span className="block text-xs font-semibold text-ink-secondary mb-2">
                              {t.costCategory ?? t.selectCategory}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {categories.map((cat) => {
                                const isSelected = line.category === cat.key;
                                return (
                                  <button
                                    key={cat.key}
                                    type="button"
                                    onClick={() => handleUpdateCostLine(idx, { category: cat.key })}
                                    className={`min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-semibold border btn-wave transition-colors select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 ${
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
                                {t.amount}
                              </label>
                              <div className="relative flex items-center">
                                <span className="absolute left-3 text-sm font-bold text-ink-muted select-none">
                                  RM
                                </span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={line.amountInput ?? (line.amountSen > 0 ? senToDecimalStr(line.amountSen) : "")}
                                  ref={idx === costAmountErrorIndex ? costAmountErrorRef : undefined}
                                  aria-invalid={idx === costAmountErrorIndex || undefined}
                                  aria-describedby={idx === costAmountErrorIndex ? `cost-amount-error-${idx}` : undefined}
                                  onChange={(e) => {
                                    const sanitized = sanitizeMoneyInput(e.target.value);
                                    if (sanitized !== null) {
                                      const sen = toSen(sanitized);
                                      handleUpdateCostLine(idx, {
                                        amountInput: sanitized,
                                        amountSen: Number(sen ?? 0n),
                                      });
                                    }
                                  }}
                                  onFocus={() => setExpandedIndex(idx)}
                                  placeholder="0.00"
                                  className={`w-full h-11 pl-10 pr-2.5 rounded-lg bg-surface-canvas border text-base font-semibold text-ink-primary tabular-nums focus:outline-none focus:bg-white focus-visible:ring-2 transition-colors ${
                                    idx === costAmountErrorIndex
                                      ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/50"
                                      : "border-surface-border focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                                  }`}
                                />
                              </div>
                              {idx === costAmountErrorIndex && (
                                <div
                                  id={`cost-amount-error-${idx}`}
                                  role="alert"
                                  className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between"
                                >
                                  <span>{t.invalidAmount}</span>
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-ink-secondary mb-1">
                                {t.note} {line.category === "other" && <span className="text-finance-loss">*</span>}
                              </label>
                              <input
                                type="text"
                                value={line.note ?? ""}
                                ref={idx === noteErrorIndex ? noteErrorRef : undefined}
                                aria-invalid={idx === noteErrorIndex || undefined}
                                aria-describedby={idx === noteErrorIndex ? `other-note-error-${idx}` : undefined}
                                onChange={(e) => {
                                  handleUpdateCostLine(idx, { note: e.target.value });
                                }}
                                onFocus={() => setExpandedIndex(idx)}
                                placeholder={line.category === "other" ? t.noteRequired : t.noteOptional}
                                className={`w-full h-11 px-3 rounded-lg bg-surface-canvas border text-sm text-ink-primary focus:outline-none focus:bg-white focus-visible:ring-2 focus-visible:ring-brand-broccoli/50 transition-colors ${
                                  idx === noteErrorIndex
                                    ? "border-finance-loss focus:border-finance-loss"
                                    : "border-surface-border focus:border-ink-primary"
                                }`}
                              />
                              {idx === noteErrorIndex && (
                                <p
                                  id={`other-note-error-${idx}`}
                                  className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium flex items-center justify-between"
                                  role="alert"
                                >
                                  <span>{t.otherNoteRequired}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
              );
            })}
          </div>
        )}

        {/* Standalone Clickable "+ Add Cost" Button at bottom */}
        {!isClosed && (
          <button
            type="button"
            onClick={handleCreateNewCostLine}
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
            <span className="relative z-10">{t.addCostLine}</span>
          </button>
        )}
        <div className="pt-2 pb-0.5" aria-hidden="true">
          <hr className="border-t border-surface-border" />
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
                  className={`${amountSizeClass(
                    grossProfitSen !== null ? formatMyr(grossProfitSen) : "—",
                    "text-base",
                    "text-xl"
                  )} font-bold ${
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
                      if (hasZeroCostLine) {
                        const zeroIdx = findZeroCostLineIndex(costLines);
                        if (zeroIdx !== -1) {
                        setExpandedIndex(zeroIdx);
                        setCostAmountErrorIndex(zeroIdx);
                        setNoteErrorIndex(null);
                        setErrorMessage(null);
                        requestAnimationFrame(() => costAmountErrorRef.current?.focus());
                        return;
                      }
                      }
                      setCostAmountErrorIndex(null);
                      setExpandedIndex(null);
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
              <span
                className={`text-base font-bold text-finance-loss whitespace-nowrap tabular-nums ${amountSizeClass(
                  formatMyr(BigInt(costLines[pendingDeleteIndex].amountSen))
                )}`.trimEnd()}
              >
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
          aria-describedby="confirm-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setShowConfirmModal(false);
          }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-surface-border space-y-4">
            <div className="space-y-1">
              <h3 id="confirm-modal-title" className="text-lg font-bold text-ink-primary">
                {t.confirmSaveTitle}
              </h3>
              <p id="confirm-modal-desc" className="text-xs text-ink-muted leading-relaxed">
                {t.confirmSaveDesc}
              </p>
            </div>

            {/* Modal Summary Info */}
            <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary font-medium">{t.totalRevenue}</span>
                <span className="font-bold text-ink-primary tabular-nums">
                  {totalRevenueSen !== null ? formatMyr(totalRevenueSen) : "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary font-medium">{t.totalCosts}</span>
                <span className="font-bold text-ink-primary tabular-nums">
                  {formatMyr(totalCostSen)}
                </span>
              </div>
              <div className="pt-2 border-t border-surface-border flex justify-between text-base">
                <span className="font-bold text-ink-primary">{t.grossProfit}</span>
                <span
                  className={`font-black tabular-nums ${
                    grossProfitSen !== null && grossProfitSen >= 0n ? "text-brand-broccoli" : "text-finance-loss"
                  }`}
                >
                  {grossProfitSen !== null ? formatMyr(grossProfitSen) : "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setShowConfirmModal(false);
                  await handleSave();
                }}
                className="flex-1 h-11 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer disabled:opacity-50"
              >
                {saving ? t.saving : t.confirmSaveBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
