"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMyr, parseSen, sanitizeMoneyInput } from "@/lib/money";
import { useI18n, translateApiError, DICTIONARY, type TranslationMap } from "@/lib/i18n";
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
  initialNoteErrorIndices?: number[];
  initialExpandedIndex?: number | null;
  initialErrorMessage?: string | null;
  fetchFn?: typeof fetch;
  formLogic?: DailySheetFormLogic;
}

const MAX_SAFE_SEN = Number.MAX_SAFE_INTEGER; // 9007199254740991

export function normalizeNote(note?: unknown): string {
  if (typeof note !== "string") {
    return "";
  }
  return note.trim();
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
    const existingIdx = merged.findIndex(
      (m) => m.category === line.category && normalizeNote(m.note) === normNote
    );
    if (existingIdx !== -1) {
      const existing = merged[existingIdx];
      const combinedAmount = existing.amountSen + line.amountSen;
      const safeAmount =
        Number.isSafeInteger(combinedAmount) && combinedAmount >= 0 && combinedAmount <= MAX_SAFE_SEN
          ? combinedAmount
          : MAX_SAFE_SEN;

      // Preserve all underlying database row IDs
      const combinedIds = [
        ...(existing.ids ?? (existing.id !== undefined ? [existing.id] : [])),
        ...(line.ids ?? (line.id !== undefined ? [line.id] : [])),
      ];

      merged[existingIdx] = {
        ...existing,
        category: existing.category,
        note: existing.note,
        amountSen: safeAmount,
        amountInput: safeAmount > 0 ? senToDecimalStr(safeAmount) : "",
        ids: combinedIds,
        clientId: existing.clientId,
      };
    } else {
      const lineIds = line.ids ? [...line.ids] : line.id !== undefined ? [line.id] : [];
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

export function validateDailySheetCostLines(
  lines: CostLineItem[]
): {
  isValid: boolean;
  invalidIndices: number[];
  invalidIndex: number | null;
  error?: string;
} {
  const invalidIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.category === "other" && !normalizeNote(line.note)) {
      invalidIndices.push(i);
    }
  }
  return {
    isValid: invalidIndices.length === 0,
    invalidIndices,
    invalidIndex: invalidIndices[0] ?? null,
    error: invalidIndices.length > 0 ? "otherNoteRequired" : undefined,
  };
}

export async function submitDailySheet({
  date,
  cashSen,
  tngSen,
  costLines,
  fetchFn,
}: {
  date: string;
  cashSen: bigint | null;
  tngSen: bigint | null;
  costLines: CostLineItem[];
  fetchFn?: typeof fetch;
}): Promise<{
  success: boolean;
  blockedClientSide?: boolean;
  invalidIndices?: number[];
  invalidOtherIndex?: number | null;
  error?: string;
  data?: any;
}> {
  if (cashSen === null || tngSen === null) {
    return { success: false, blockedClientSide: true, error: "invalidAmount" };
  }
  // Priority rule: Amount must be valid and > 0 before checking note requirements; an empty/RM0 line is incomplete input (invalidAmount) rather than a note omission (otherNoteRequired).
  if (costLines.some((l) => l.amountSen <= 0)) {
    return { success: false, blockedClientSide: true, error: "invalidAmount" };
  }
  const validation = validateDailySheetCostLines(costLines);
  if (!validation.isValid) {
    return {
      success: false,
      blockedClientSide: true,
      invalidIndices: validation.invalidIndices,
      invalidOtherIndex: validation.invalidIndex,
      error: "otherNoteRequired",
    };
  }

  const endpoint = "/api/sheets";
  const requestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date,
      cashSen: Number(cashSen),
      tngSen: Number(tngSen),
      costLines: costLines
        .filter((l) => l.amountSen > 0)
        .map((l) => ({
          category: l.category,
          amountSen: l.amountSen,
          note: (l.note || "").trim() || undefined,
        })),
    }),
  };

  const res = fetchFn ? await fetchFn(endpoint, requestInit) : await fetch(endpoint, requestInit);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      blockedClientSide: false,
      error: data.error || "Save error",
      data,
    };
  }
  return { success: true, data };
}

function senToDecimalStr(sen: number | bigint): string {
  const num = Number(sen);
  if (!num) return "";
  const ringgit = Math.floor(num / 100);
  const cents = (num % 100).toString().padStart(2, "0");
  return cents === "00" ? `${ringgit}` : `${ringgit}.${cents}`;
}

export function toSen(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  try {
    return parseSen(trimmed);
  } catch {
    return null;
  }
}

export interface DailySheetFormState {
  date: string;
  cashInput: string;
  tngInput: string;
  costLines: CostLineItem[];
  noteErrorIndices: Set<number>;
  expandedIndex: number | null;
  focusNoteIndex: number | null;
  errorMessage: string | null;
  successMessage: string | null;
  saving: boolean;
  showConfirmModal: boolean;
  pendingDeleteIndex: number | null;
  isCalendarOpen: boolean;
  baseline: {
    cashInput: string;
    tngInput: string;
    costLines: CostLineItem[];
  };
}

export interface DailySheetFormLogicOptions {
  date: string;
  initialCashSen: number;
  initialTngSen: number;
  initialCostLines: CostLineItem[];
  isClosed: boolean;
  todayKl: string;
  initialCashInput?: string;
  initialTngInput?: string;
  initialNoteErrorIndices?: number[];
  initialExpandedIndex?: number | null;
  initialErrorMessage?: string | null;
  fetchFn?: typeof fetch;
  router?: { push: (url: string) => void; refresh: () => void };
  t?: TranslationMap;
  startTransition?: (callback: () => void) => void;
}

export class DailySheetFormLogic {
  private state: DailySheetFormState;
  private options: DailySheetFormLogicOptions;
  private listeners: Set<(state: DailySheetFormState) => void> = new Set();

  constructor(options: DailySheetFormLogicOptions) {
    this.options = options;
    const initCash = options.initialCashInput !== undefined
      ? options.initialCashInput
      : (options.initialCashSen > 0 ? senToDecimalStr(options.initialCashSen) : "");
    const initTng = options.initialTngInput !== undefined
      ? options.initialTngInput
      : (options.initialTngSen > 0 ? senToDecimalStr(options.initialTngSen) : "");
    const merged = mergeCostLines(options.initialCostLines);
    const zeroIdx = merged.findIndex((l) => l.amountSen === 0);
    const defaultExpanded = options.initialExpandedIndex !== undefined
      ? options.initialExpandedIndex
      : (zeroIdx !== -1 ? zeroIdx : (merged.length === 1 ? 0 : null));

    this.state = {
      date: options.date,
      cashInput: initCash,
      tngInput: initTng,
      costLines: merged,
      noteErrorIndices: new Set(options.initialNoteErrorIndices ?? []),
      expandedIndex: defaultExpanded,
      focusNoteIndex: null,
      errorMessage: options.initialErrorMessage ?? null,
      successMessage: null,
      saving: false,
      showConfirmModal: false,
      pendingDeleteIndex: null,
      isCalendarOpen: false,
      baseline: {
        cashInput: initCash,
        tngInput: initTng,
        costLines: merged,
      },
    };
  }

  public getState(): DailySheetFormState {
    return this.state;
  }

  public subscribe(listener: (state: DailySheetFormState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<DailySheetFormState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  public setCashInput(val: string): void {
    this.update({ cashInput: val, errorMessage: null });
  }

  public setTngInput(val: string): void {
    this.update({ tngInput: val, errorMessage: null });
  }

  public setExpandedIndex(idx: number | null): void {
    this.update({ expandedIndex: idx });
  }

  public clearFocusNoteIndex(): void {
    this.update({ focusNoteIndex: null });
  }

  public setErrorMessage(msg: string | null): void {
    this.update({ errorMessage: msg });
  }

  public setSuccessMessage(msg: string | null): void {
    this.update({ successMessage: msg });
  }

  public setShowConfirmModal(show: boolean): void {
    this.update({ showConfirmModal: show });
  }

  public setPendingDeleteIndex(idx: number | null): void {
    this.update({ pendingDeleteIndex: idx });
  }

  public setIsCalendarOpen(open: boolean | ((prev: boolean) => boolean)): void {
    const next = typeof open === "function" ? open(this.state.isCalendarOpen) : open;
    this.update({ isCalendarOpen: next });
  }

  public handleRevert(): void {
    this.update({
      cashInput: this.state.baseline.cashInput,
      tngInput: this.state.baseline.tngInput,
      costLines: this.state.baseline.costLines,
      noteErrorIndices: new Set(),
      errorMessage: null,
    });
  }

  public handleCreateNewCostLine(): void {
    if (this.options.isClosed) return;
    const validation = validateDailySheetCostLines(this.state.costLines);
    if (!validation.isValid) {
      this.update({
        expandedIndex: validation.invalidIndices[0],
        noteErrorIndices: new Set(validation.invalidIndices),
        focusNoteIndex: validation.invalidIndices[0],
      });
      return;
    }
    const newLine: CostLineItem = {
      clientId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: "restock",
      amountSen: 0,
      amountInput: "",
      note: "",
      ids: [],
    };
    const nextLines = [...this.state.costLines, newLine];
    this.update({
      costLines: nextLines,
      expandedIndex: this.state.costLines.length,
    });
  }

  public handleUpdateCostLine(index: number, patch: Partial<CostLineItem>): void {
    const currentLine = this.state.costLines[index];
    const updatedCat = patch.category !== undefined ? patch.category : currentLine?.category;
    const updatedNote = patch.note !== undefined ? patch.note : currentLine?.note;

    let nextNoteErrors = new Set(this.state.noteErrorIndices);
    if (updatedCat === "other" && !normalizeNote(updatedNote)) {
      nextNoteErrors.add(index);
    } else if (nextNoteErrors.has(index)) {
      nextNoteErrors.delete(index);
    }

    const nextLines = this.state.costLines.map((line, i) =>
      i === index ? { ...line, ...patch } : line
    );

    this.update({
      costLines: nextLines,
      expandedIndex: index,
      noteErrorIndices: nextNoteErrors,
    });
  }

  public handleRemoveCostLine(index: number): void {
    if (this.options.isClosed) return;
    const nextErrors = new Set<number>();
    for (const idx of this.state.noteErrorIndices) {
      if (idx < index) nextErrors.add(idx);
      else if (idx > index) nextErrors.add(idx - 1);
    }
    const nextLines = this.state.costLines.filter((_, i) => i !== index);
    this.update({
      costLines: nextLines,
      noteErrorIndices: nextErrors,
    });
  }

  public onSaveClick(): void {
    const t = this.options.t ?? DICTIONARY.zh;
    const cashSen = toSen(this.state.cashInput);
    const tngSen = toSen(this.state.tngInput);
    const cashError = this.state.cashInput.trim() !== "" && cashSen === null;
    const tngError = this.state.tngInput.trim() !== "" && tngSen === null;

    if (cashError || tngError || cashSen === null || tngSen === null) {
      this.update({ errorMessage: t.invalidAmount });
      return;
    }
    // Priority rule: Amount must be valid and > 0 before checking note requirements; an empty/RM0 line is incomplete input (invalidAmount) rather than a note omission (otherNoteRequired).
    const hasZeroCostLine = this.state.costLines.some((l) => l.amountSen <= 0);
    if (hasZeroCostLine) {
      const zeroIdx = this.state.costLines.findIndex((l) => l.amountSen <= 0);
      this.update({
        expandedIndex: zeroIdx !== -1 ? zeroIdx : this.state.expandedIndex,
        errorMessage: t.invalidAmount,
      });
      return;
    }

    const validation = validateDailySheetCostLines(this.state.costLines);
    if (!validation.isValid) {
      this.update({
        expandedIndex: validation.invalidIndices[0],
        noteErrorIndices: new Set(validation.invalidIndices),
        focusNoteIndex: validation.invalidIndices[0],
      });
      return;
    }

    this.update({
      expandedIndex: null,
      showConfirmModal: true,
    });
  }

  public async handleSave(): Promise<void> {
    if (this.state.saving || this.options.isClosed) return;
    const t = this.options.t ?? DICTIONARY.zh;
    const cashSen = toSen(this.state.cashInput);
    const tngSen = toSen(this.state.tngInput);
    const cashError = this.state.cashInput.trim() !== "" && cashSen === null;
    const tngError = this.state.tngInput.trim() !== "" && tngSen === null;

    if (cashError || tngError || cashSen === null || tngSen === null) {
      this.update({ errorMessage: t.invalidAmount });
      return;
    }
    // Priority rule: Amount must be valid and > 0 before checking note requirements; an empty/RM0 line is incomplete input (invalidAmount) rather than a note omission (otherNoteRequired).
    const hasZeroCostLine = this.state.costLines.some((l) => l.amountSen <= 0);
    if (hasZeroCostLine) {
      const zeroIdx = this.state.costLines.findIndex((l) => l.amountSen <= 0);
      this.update({
        expandedIndex: zeroIdx !== -1 ? zeroIdx : this.state.expandedIndex,
        errorMessage: t.invalidAmount,
      });
      return;
    }

    const validation = validateDailySheetCostLines(this.state.costLines);
    if (!validation.isValid) {
      this.update({
        expandedIndex: validation.invalidIndices[0],
        noteErrorIndices: new Set(validation.invalidIndices),
        focusNoteIndex: validation.invalidIndices[0],
      });
      return;
    }

    this.update({ errorMessage: null, successMessage: null, saving: true });

    try {
      const result = await submitDailySheet({
        date: this.state.date,
        cashSen,
        tngSen,
        costLines: this.state.costLines,
        fetchFn: this.options.fetchFn,
      });

      if (!result.success) {
        if (result.blockedClientSide && result.invalidIndices && result.invalidIndices.length > 0) {
          this.update({
            expandedIndex: result.invalidIndices[0],
            noteErrorIndices: new Set(result.invalidIndices),
            focusNoteIndex: result.invalidIndices[0],
          });
          return;
        }
        this.update({ errorMessage: translateApiError(result.error, t) });
        return;
      }

      const data = result.data;
      if (data?.sheet && Array.isArray(data.costLines)) {
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

        this.update({
          baseline: {
            cashInput: savedCash,
            tngInput: savedTng,
            costLines: savedCostLines,
          },
          costLines: savedCostLines,
          cashInput: savedCash,
          tngInput: savedTng,
        });
      }

      this.update({ successMessage: t.saveSuccess });
      setTimeout(() => {
        this.update({ successMessage: null });
      }, 3500);

      if (this.options.startTransition && this.options.router) {
        this.options.startTransition(() => {
          this.options.router?.refresh();
        });
      } else if (this.options.router) {
        this.options.router.refresh();
      }
    } catch (err: any) {
      this.update({ errorMessage: translateApiError(err?.message, t) });
    } finally {
      this.update({ saving: false });
    }
  }

  public resetWithProps(options: Partial<DailySheetFormLogicOptions>): void {
    const cashStr = options.initialCashInput !== undefined
      ? options.initialCashInput
      : (options.initialCashSen && options.initialCashSen > 0 ? senToDecimalStr(options.initialCashSen) : "");
    const tngStr = options.initialTngInput !== undefined
      ? options.initialTngInput
      : (options.initialTngSen && options.initialTngSen > 0 ? senToDecimalStr(options.initialTngSen) : "");
    const mergedInitial = options.initialCostLines ? mergeCostLines(options.initialCostLines) : this.state.costLines;
    const zeroIdx = mergedInitial.findIndex((l) => l.amountSen === 0);

    this.update({
      date: options.date ?? this.state.date,
      cashInput: cashStr,
      tngInput: tngStr,
      costLines: mergedInitial,
      baseline: {
        cashInput: cashStr,
        tngInput: tngStr,
        costLines: mergedInitial,
      },
      expandedIndex: zeroIdx !== -1 ? zeroIdx : (mergedInitial.length === 1 ? 0 : null),
      noteErrorIndices: new Set(options.initialNoteErrorIndices ?? []),
      errorMessage: null,
    });
  }
}

export function createDailySheetFormLogic(options: DailySheetFormLogicOptions): DailySheetFormLogic {
  return new DailySheetFormLogic(options);
}

export function DailySheetForm(props: DailySheetFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();

  const form = useMemo(
    () => props.formLogic ?? createDailySheetFormLogic({
      ...props,
      router,
      t,
      startTransition,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.formLogic, props.date]
  );

  const [state, setState] = useState<DailySheetFormState>(() => form.getState());

  useEffect(() => {
    return form.subscribe((nextState) => {
      setState(nextState);
    });
  }, [form]);

  // Calendar popover trigger ref
  const dateBtnRef = useRef<HTMLButtonElement>(null);
  const noteInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Focus note input when requested
  useEffect(() => {
    if (state.focusNoteIndex !== null) {
      const el = noteInputRefs.current.get(state.focusNoteIndex);
      if (el) {
        el.focus();
        form.clearFocusNoteIndex();
      }
    }
  }, [state.focusNoteIndex, state.expandedIndex, form]);

  // Close modals on Escape key
  useEffect(() => {
    if (!state.showConfirmModal && state.pendingDeleteIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        form.setShowConfirmModal(false);
        form.setPendingDeleteIndex(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state.showConfirmModal, state.pendingDeleteIndex, form]);

  // Check if current form inputs differ from baseline
  const isModified = useMemo(() => {
    if (state.cashInput.trim() !== state.baseline.cashInput.trim()) return true;
    if (state.tngInput.trim() !== state.baseline.tngInput.trim()) return true;
    if (state.costLines.length !== state.baseline.costLines.length) return true;

    for (let i = 0; i < state.costLines.length; i++) {
      const curr = state.costLines[i];
      const base = state.baseline.costLines[i];
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
  }, [state.cashInput, state.tngInput, state.costLines, state.baseline]);

  // Update form inputs when selected date or initial data changes (prod flow)
  useEffect(() => {
    if (!props.formLogic) {
      form.resetWithProps({
        date: props.date,
        initialCashSen: props.initialCashSen,
        initialTngSen: props.initialTngSen,
        initialCostLines: props.initialCostLines,
        initialCashInput: props.initialCashInput,
        initialTngInput: props.initialTngInput,
        initialNoteErrorIndices: props.initialNoteErrorIndices,
      });
    }
  }, [props.date, props.initialCashSen, props.initialTngSen, props.initialCashInput, props.initialTngInput, props.initialCostLines, props.initialNoteErrorIndices, props.formLogic, form]);

  const cashSen = toSen(state.cashInput);
  const tngSen = toSen(state.tngInput);
  const cashError = state.cashInput.trim() !== "" && cashSen === null;
  const tngError = state.tngInput.trim() !== "" && tngSen === null;
  const hasParseError = cashError || tngError;

  const totalRevenueSen =
    hasParseError || cashSen === null || tngSen === null
      ? null
      : cashSen + tngSen;

  const totalCostSen = state.costLines.reduce(
    (acc, line) => acc + BigInt(line.amountSen),
    0n,
  );
  const hasZeroCostLine = state.costLines.some((line) => line.amountSen <= 0);

  const grossProfitSen =
    totalRevenueSen !== null ? totalRevenueSen - totalCostSen : null;

  // Navigation between dates
  function navigateDate(offsetDays: number) {
    const current = new Date(`${props.date}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + offsetDays);
    const targetDate = current.toISOString().slice(0, 10);
    router.push(`/?date=${targetDate}`);
  }

  const isToday = props.date === props.todayKl;
  const canGoNext = props.date < props.todayKl;

  const categories: { key: CostCategory; label: string }[] = [
    { key: "restock", label: t.catRestock },
    { key: "gas", label: t.catGas },
    { key: "transport", label: t.catTransport },
    { key: "wages-daily", label: t.catWagesDaily },
    { key: "maintenance", label: t.catMaintenance },
    { key: "other", label: t.catOther },
  ];

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
              onClick={() => form.setIsCalendarOpen((prev) => !prev)}
              aria-expanded={state.isCalendarOpen}
              aria-haspopup="dialog"
              className="relative text-center group cursor-pointer px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors focus:outline-none max-w-full"
              title="点击打开/关闭日历 (Click to toggle calendar)"
            >
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                <span className="text-base font-bold text-ink-primary group-hover:text-brand-broccoli transition-colors">
                  {props.date}
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
              date={props.date}
              todayKl={props.todayKl}
              isOpen={state.isCalendarOpen}
              triggerRef={dateBtnRef}
              onClose={() => form.setIsCalendarOpen(false)}
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

        {/* Locked Month Notification Notice */}
        {props.isClosed && (
          <div
            role="status"
            className="p-3 bg-finance-neutral/10 border border-finance-neutral/30 rounded-lg text-ink-secondary text-sm font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
            {t.totalRevenue}: <span className="font-semibold text-ink-primary tabular-nums">{totalRevenueSen !== null ? formatMyr(totalRevenueSen) : "—"}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Cash Revenue Card */}
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs focus-within:border-brand-broccoli transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-brand-broccoli inline-block shrink-0" />
              <label htmlFor="cash-input" className="text-sm font-bold text-ink-primary select-none cursor-pointer">
                {t.cashRevenue}
              </label>
              <span className="text-[13px] text-ink-muted select-none">
                ({t.cashSub})
              </span>
            </div>
            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-sm font-semibold text-ink-muted select-none">
                RM
              </span>
              <input
                id="cash-input"
                type="text"
                inputMode="decimal"
                value={state.cashInput}
                onChange={(e) => {
                  const sanitized = sanitizeMoneyInput(e.target.value);
                  if (sanitized !== null) {
                    form.setCashInput(sanitized);
                  }
                }}
                disabled={props.isClosed}
                placeholder="0.00"
                aria-invalid={cashError}
                aria-describedby={cashError ? "cash-input-error" : undefined}
                className={`w-full h-11 pl-9 pr-2.5 rounded-lg bg-surface-canvas border text-base font-semibold text-ink-primary tabular-nums focus:outline-none focus:bg-white focus-visible:ring-2 disabled:bg-surface-subtle disabled:cursor-not-allowed ${
                  cashError
                    ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/50"
                    : "border-surface-border focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                }`}
              />
            </div>
            {cashError && (
              <div
                id="cash-input-error"
                role="alert"
                className="mt-1.5 py-1 px-2 rounded bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-semibold"
              >
                {t.invalidAmount}
              </div>
            )}
          </div>

          {/* TnG Revenue Card */}
          <div className="bg-white border border-surface-border rounded-xl p-3 shadow-xs focus-within:border-channel-tng transition-all">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-channel-tng inline-block shrink-0" />
              <label htmlFor="tng-input" className="text-sm font-bold text-ink-primary select-none cursor-pointer">
                {t.tngRevenue}
              </label>
              <span className="text-[13px] text-ink-muted select-none">
                ({t.tngSub})
              </span>
            </div>
            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-sm font-semibold text-ink-muted select-none">
                RM
              </span>
              <input
                id="tng-input"
                type="text"
                inputMode="decimal"
                value={state.tngInput}
                onChange={(e) => {
                  const sanitized = sanitizeMoneyInput(e.target.value);
                  if (sanitized !== null) {
                    form.setTngInput(sanitized);
                  }
                }}
                disabled={props.isClosed}
                placeholder="0.00"
                aria-invalid={tngError}
                aria-describedby={tngError ? "tng-input-error" : undefined}
                className={`w-full h-11 pl-9 pr-2.5 rounded-lg bg-surface-canvas border text-base font-semibold text-ink-primary tabular-nums focus:outline-none focus:bg-white focus-visible:ring-2 disabled:bg-surface-subtle disabled:cursor-not-allowed ${
                  tngError
                    ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/50"
                    : "border-surface-border focus:border-channel-tng focus-visible:ring-channel-tng/50"
                }`}
              />
            </div>
            {tngError && (
              <div
                id="tng-input-error"
                role="alert"
                className="mt-1.5 py-1 px-2 rounded bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-semibold"
              >
                {t.invalidAmount}
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
        {state.costLines.length > 0 && (
          <div className="space-y-2">
            {state.costLines.map((line, idx) => {
              const isZero = line.amountSen === 0;
              const hasNoteError = state.noteErrorIndices.has(idx);
              const isExpanded = state.expandedIndex === idx || isZero;
              return (
                <div
                  key={getCostLineKey(line, idx)}
                  className={`bg-white border rounded-xl shadow-xs transition-all overflow-hidden ${
                    hasNoteError
                      ? "border-finance-loss ring-2 ring-finance-loss/20"
                      : isExpanded
                      ? "border-brand-broccoli ring-2 ring-brand-broccoli/20"
                      : "border-surface-border hover:border-slate-300"
                  }`}
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => {
                      if (props.isClosed) return;
                      if (isZero) return;
                      form.setExpandedIndex(isExpanded ? null : idx);
                    }}
                    role="button"
                    tabIndex={isZero ? -1 : 0}
                    aria-disabled={isZero}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!props.isClosed && !isZero) form.setExpandedIndex(isExpanded ? null : idx);
                      }
                    }}
                    className={`w-full px-4 py-3 flex items-center justify-between gap-2 select-none bg-white transition-colors ${
                      isZero ? "cursor-default" : "cursor-pointer hover:bg-surface-subtle/50"
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
                      <span className="text-base font-bold text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMyr(BigInt(line.amountSen))}
                      </span>

                      {!props.isClosed && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            form.setPendingDeleteIndex(idx);
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
                  {isExpanded && !props.isClosed && (
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
                                onClick={() => form.handleUpdateCostLine(idx, { category: cat.key })}
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
                              onChange={(e) => {
                                const sanitized = sanitizeMoneyInput(e.target.value);
                                if (sanitized !== null) {
                                  const sen = toSen(sanitized);
                                  form.handleUpdateCostLine(idx, {
                                    amountInput: sanitized,
                                    amountSen: Number(sen ?? 0n),
                                  });
                                }
                              }}
                              onFocus={() => form.setExpandedIndex(idx)}
                              placeholder="0.00"
                              className="w-full h-11 pl-10 pr-2.5 rounded-lg bg-surface-canvas border border-surface-border text-base font-semibold text-ink-primary tabular-nums focus:outline-none focus:bg-white focus:border-ink-primary focus-visible:ring-2 focus-visible:ring-brand-broccoli/50 transition-colors"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor={`cost-note-${idx}`}
                            className="block text-xs font-semibold text-ink-secondary mb-1"
                          >
                            {t.note} {line.category === "other" && <span className="text-finance-loss">*</span>}
                          </label>
                          <input
                            id={`cost-note-${idx}`}
                            ref={(el) => {
                              if (el) {
                                noteInputRefs.current.set(idx, el);
                              } else {
                                noteInputRefs.current.delete(idx);
                              }
                            }}
                            type="text"
                            value={line.note ?? ""}
                            onChange={(e) => {
                              form.handleUpdateCostLine(idx, { note: e.target.value });
                            }}
                            onFocus={() => form.setExpandedIndex(idx)}
                            placeholder={line.category === "other" ? t.noteRequired : t.noteOptional}
                            aria-invalid={hasNoteError}
                            aria-describedby={hasNoteError ? `cost-note-error-${idx}` : undefined}
                            className={`w-full h-11 px-3 rounded-lg bg-surface-canvas border text-sm text-ink-primary focus:outline-none focus:bg-white focus-visible:ring-2 transition-colors ${
                              hasNoteError
                                ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/50"
                                : "border-surface-border focus:border-ink-primary focus-visible:ring-brand-broccoli/50"
                            }`}
                          />
                          {hasNoteError && (
                            <div
                              id={`cost-note-error-${idx}`}
                              className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium flex items-center justify-between animate-slide-down"
                            >
                              <span>{t.otherNoteRequired}</span>
                            </div>
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

        {/* Standalone Clickable "+ Add Cost" Button at bottom: hidden if any item has RM 0 */}
        {!props.isClosed && !hasZeroCostLine && (
          <button
            type="button"
            onClick={() => form.handleCreateNewCostLine()}
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
        {state.errorMessage && (
          <div className="py-2.5 px-3.5 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-center justify-between shadow-md animate-slide-down">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="truncate">{state.errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => form.setErrorMessage(null)}
              className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-7 h-7 flex items-center justify-center rounded-md shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}

        {state.successMessage && (
          <div className="py-2.5 px-3.5 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/30 text-sm text-brand-broccoli font-bold flex items-center justify-between shadow-md animate-slide-down">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 shrink-0 text-brand-broccoli" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="truncate">{state.successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => form.setSuccessMessage(null)}
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

          {!props.isClosed && (
            <div className="flex items-center gap-2">
              {isModified && (
                <button
                  type="button"
                  onClick={() => form.handleRevert()}
                  disabled={state.saving}
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
                data-testid="save-button"
                disabled={state.saving || hasParseError}
                onClick={() => form.onSaveClick()}
                className="h-12 px-5 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-semibold text-sm tracking-wide shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 focus-visible:ring-offset-1"
              >
                {state.saving ? (
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
      {state.pendingDeleteIndex !== null && state.costLines[state.pendingDeleteIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-cost-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) form.setPendingDeleteIndex(null);
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
                  {getCategoryLabel(state.costLines[state.pendingDeleteIndex].category)}
                </span>
                {state.costLines[state.pendingDeleteIndex].note && (
                  <span className="text-xs text-ink-muted truncate">
                    {state.costLines[state.pendingDeleteIndex].note}
                  </span>
                )}
              </div>
              <span className="text-base font-bold text-finance-loss whitespace-nowrap">
                {formatMyr(BigInt(state.costLines[state.pendingDeleteIndex].amountSen))}
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => form.setPendingDeleteIndex(null)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (state.pendingDeleteIndex !== null) {
                    form.handleRemoveCostLine(state.pendingDeleteIndex);
                    form.setPendingDeleteIndex(null);
                  }
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
      {state.showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          aria-describedby="confirm-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget && !state.saving) form.setShowConfirmModal(false);
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
                disabled={state.saving}
                onClick={() => form.setShowConfirmModal(false)}
                className="flex-1 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary font-semibold text-sm transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                data-testid="confirm-save-button"
                disabled={state.saving}
                onClick={async () => {
                  form.setShowConfirmModal(false);
                  await form.handleSave();
                }}
                className="flex-1 h-11 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-bold text-sm transition-colors flex items-center justify-center gap-1.5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 cursor-pointer disabled:opacity-50"
              >
                {state.saving ? t.saving : t.confirmSaveBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
