"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amountSizeClass, sanitizeMoneyInput, tryParseSen } from "@/lib/money";
import { apiFetch } from "@/lib/cloud-client";
import { useI18n, translateApiError, apiErrorPayloadFrom } from "@/lib/i18n";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { useModalFocusTrap } from "@/lib/use-modal-focus-trap";
import { CalendarPopover } from "@/components/CalendarPopover";
import { MoneyValue, formatDisplayMyr } from "@/components/MoneyValue";
import {
  COST_CATEGORY_TOKENS,
  CashIcon,
  CostCategoryIcon,
  TngIcon,
} from "@/components/BokliIcons";
import { isOtherNoteMissing, type CostCategory } from "@/lib/vocab";
import {
  CostLineAmountOverflowError,
  costLineIdentityKey,
  groupCostLines,
  type CostLineGroup,
} from "@/lib/cost-line-group";
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
  /** Cloud build: re-fetch the page data; router.refresh() only re-renders a static page. */
  onRefresh?: () => void;
  date: string;
  initialCashSen: number;
  initialTngSen: number;
  initialCostLines: CostLineItem[];
  isClosed: boolean;
  todayKl: string;
  savedSheet?: { id: number; updatedAt: string } | null;
  initialCashInput?: string;
  initialTngInput?: string;
  initialNoteErrorIndex?: number | null;
  initialCostAmountErrorIndex?: number | null;
  initialErrorMessage?: string | null;
  initialExpandedIndex?: number | null;
}

const SUCCESS_BANNER_MS = 3500;

export function normalizeNote(note?: unknown): string {
  if (typeof note !== "string") {
    return "";
  }
  return note.trim();
}

export function findMissingOtherNoteIndex(
  lines: Pick<CostLineItem, "category" | "note">[]
): number {
  return lines.findIndex((line) => isOtherNoteMissing(line.category, line.note));
}

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

function toMergedCostLine(group: CostLineGroup<CostLineItem>): CostLineItem {
  const first = group.members[0];
  const ids: number[] = [];
  for (const member of group.members) {
    for (const id of extractCostLineIds(member)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return {
    category: first.category,
    note: first.note,
    amountSen: group.amountSen,
    amountInput: senToDecimalStr(group.amountSen),
    ids,
    clientId: group.members.find((m) => m.clientId !== undefined)?.clientId,
  };
}

export function consolidateCostLines(lines: CostLineItem[]): CostLineItem[] {
  const positiveIdx: number[] = [];
  lines.forEach((line, i) => {
    if (line.amountSen > 0) positiveIdx.push(i);
  });

  let groups: CostLineGroup<CostLineItem>[];
  try {
    groups = groupCostLines(positiveIdx.map((i) => lines[i]));
  } catch (err) {
    if (err instanceof CostLineAmountOverflowError) {
      throw new CostLineAmountOverflowError(positiveIdx[err.index], err.message);
    }
    throw err;
  }

  const groupAt = new Map<number, CostLineGroup<CostLineItem>>();
  for (const group of groups) groupAt.set(positiveIdx[group.indexes[0]], group);

  const result: CostLineItem[] = [];
  lines.forEach((line, i) => {
    if (line.amountSen <= 0) {
      result.push(line);
      return;
    }
    const group = groupAt.get(i);
    if (!group) return;
    result.push(group.members.length === 1 ? line : toMergedCostLine(group));
  });
  return result;
}

function normalizeLoadedCostLine(line: CostLineItem): CostLineItem {
  return {
    category: line.category,
    note: normalizeNote(line.note) || null,
    amountSen: line.amountSen,
    amountInput: line.amountInput ?? senToDecimalStr(line.amountSen),
    ids: extractCostLineIds(line),
    clientId: line.clientId,
  };
}

export function mergeCostLines(lines: CostLineItem[]): CostLineItem[] {
  return consolidateCostLines(lines.map(normalizeLoadedCostLine));
}

export function tryConsolidateCostLines(lines: CostLineItem[]): {
  lines: CostLineItem[];
  overflowIndex: number | null;
} {
  try {
    return { lines: consolidateCostLines(lines), overflowIndex: null };
  } catch (err) {
    if (err instanceof CostLineAmountOverflowError) {
      return { lines, overflowIndex: err.index };
    }
    throw err;
  }
}

export function consolidateCostLinesForSave(lines: CostLineItem[]): {
  lines: CostLineItem[];
  amountErrorIndex: number | null;
} {
  const result = tryConsolidateCostLines(lines);
  if (result.overflowIndex !== null) {
    return { lines: result.lines, amountErrorIndex: result.overflowIndex };
  }
  const zeroIdx = findZeroCostLineIndex(result.lines);
  return { lines: result.lines, amountErrorIndex: zeroIdx === -1 ? null : zeroIdx };
}

export function createNewCostLine(
  costLines: CostLineItem[],
  newLineFactory?: () => CostLineItem
): { lines: CostLineItem[]; expandedIndex: number } {
  const consolidated = tryConsolidateCostLines(costLines).lines;
  const filledOnly = consolidated.filter((line) => line.amountSen > 0);
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

    const targetKey = costLineIdentityKey(targetLine.category, targetLine.note);
    const keyIdx = consolidated.findIndex(
      (l) => l.amountSen > 0 && costLineIdentityKey(l.category, l.note) === targetKey
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

  const { lines: consolidated, overflowIndex } = tryConsolidateCostLines(lines);
  if (overflowIndex !== null) {
    return {
      lines,
      expandedIndex: currentExpandedIndex === clickedIndex ? null : clickedIndex,
      noteErrorIndex: options?.noteErrorIndex ?? null,
      costAmountErrorIndex: options?.costAmountErrorIndex ?? null,
    };
  }

  let noteErrorIndex: number | null = null;
  if (options?.noteErrorIndex !== undefined && options.noteErrorIndex !== null) {
    const errLine = lines[options.noteErrorIndex];
    if (errLine) {
      const newIdx = findConsolidatedLineIndex(errLine, consolidated);
      if (
        newIdx !== -1 &&
        isOtherNoteMissing(consolidated[newIdx].category, consolidated[newIdx].note)
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

  const clickedKey = costLineIdentityKey(clickedLine.category, clickedLine.note);
  const wasMergedAway =
    clickedLine.amountSen > 0 &&
    lines.slice(0, clickedIndex).some(
      (l) => l.amountSen > 0 && costLineIdentityKey(l.category, l.note) === clickedKey
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

export type DraftField = "cash" | "tng" | "costLines";

export function rebaseCostLinesAfterSave(
  localLines: CostLineItem[],
  savedLines: CostLineItem[],
  touchedDuringSave: boolean
): CostLineItem[] {
  if (!touchedDuringSave) return savedLines;

  const claimed = new Set<number>();
  return localLines.map((line) => {
    const matchIdx = savedLines.findIndex(
      (saved, i) =>
        !claimed.has(i) &&
        saved.category === line.category &&
        saved.amountSen === line.amountSen &&
        normalizeNote(saved.note) === normalizeNote(line.note)
    );
    if (matchIdx === -1) {
      return line;
    }
    claimed.add(matchIdx);
    return { ...line, id: savedLines[matchIdx].id, ids: savedLines[matchIdx].ids };
  });
}

export function canOpenDeleteSheetModal(open: {
  showConfirmModal: boolean;
  pendingDeleteIndex: number | null;
}): boolean {
  return !open.showConfirmModal && open.pendingDeleteIndex === null;
}

function formatWeekday(dateStr: string, lang: "zh" | "en"): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const zhDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const enDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return lang === "zh" ? zhDays[dt.getUTCDay()] : enDays[dt.getUTCDay()];
}

export function DailySheetForm({
  onRefresh,
  date,
  initialCashSen,
  initialTngSen,
  initialCostLines,
  isClosed,
  todayKl,
  savedSheet: initialSavedSheet = null,
  initialCashInput,
  initialTngInput,
  initialNoteErrorIndex = null,
  initialCostAmountErrorIndex = null,
  initialErrorMessage = null,
  initialExpandedIndex,
}: DailySheetFormProps) {
  const router = useRouter();
  const refresh = onRefresh ?? (() => router.refresh());
  const { t, lang } = useI18n();
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

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  const initCashStr = initialCashInput !== undefined ? initialCashInput : senToDecimalStr(initialCashSen);
  const initTngStr = initialTngInput !== undefined ? initialTngInput : senToDecimalStr(initialTngSen);
  const [cashInput, setCashInput] = useState(initCashStr);
  const [tngInput, setTngInput] = useState(initTngStr);

  const [costLines, setCostLines] = useState<CostLineItem[]>(() =>
    mergeCostLines(initialCostLines)
  );

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [saveModalError, setSaveModalError] = useState<string | null>(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [showDeleteSheetModal, setShowDeleteSheetModal] = useState(false);
  const [deletingSheet, setDeletingSheet] = useState(false);
  const [deleteSheetError, setDeleteSheetError] = useState<string | null>(null);
  const [savedSheet, setSavedSheet] = useState(initialSavedSheet);
  const savedSheetId = initialSavedSheet?.id ?? null;
  const savedSheetUpdatedAt = initialSavedSheet?.updatedAt ?? null;
  useEffect(() => {
    setSavedSheet(
      savedSheetId !== null && savedSheetUpdatedAt !== null
        ? { id: savedSheetId, updatedAt: savedSheetUpdatedAt }
        : null,
    );
    if (savedSheetId === null) setShowDeleteSheetModal(false);
  }, [savedSheetId, savedSheetUpdatedAt]);
  const sheetExists = savedSheet !== null;
  const deleteSheetBtnRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const deleteCostLineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteSheetModalRef = useRef<HTMLDivElement>(null);
  const deleteCostLineModalRef = useRef<HTMLDivElement>(null);
  const confirmSaveModalRef = useRef<HTMLDivElement>(null);
  const dockSentinelRef = useRef<HTMLDivElement>(null);
  const [isDockStuck, setIsDockStuck] = useState(false);

  useEffect(() => {
    const updateDockStuck = () => {
      if (window.innerWidth >= 1024) {
        setIsDockStuck(false);
        return;
      }
      const sentinel = dockSentinelRef.current;
      if (!sentinel) return;
      const nav = document.querySelector<HTMLElement>('[data-bottom-nav="true"]');
      const navHeight = nav ? nav.getBoundingClientRect().height : 64;
      setIsDockStuck(sentinel.getBoundingClientRect().top > window.innerHeight - navHeight + 2);
    };
    updateDockStuck();
    window.addEventListener("scroll", updateDockStuck, { passive: true });
    window.addEventListener("resize", updateDockStuck, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateDockStuck) : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", updateDockStuck);
      window.removeEventListener("resize", updateDockStuck);
      ro?.disconnect();
    };
  }, []);

  const mutationInFlightRef = useRef<"save" | "delete" | null>(null);

  const isCalendarOpenRef = useRef(isCalendarOpen);
  const showConfirmModalRef = useRef(showConfirmModal);
  const pendingDeleteIndexRef = useRef(pendingDeleteIndex);
  const showDeleteSheetModalRef = useRef(showDeleteSheetModal);
  const savingRef = useRef(saving);
  const deletingSheetRef = useRef(deletingSheet);
  useEffect(() => {
    isCalendarOpenRef.current = isCalendarOpen;
    showConfirmModalRef.current = showConfirmModal;
    pendingDeleteIndexRef.current = pendingDeleteIndex;
    showDeleteSheetModalRef.current = showDeleteSheetModal;
    savingRef.current = saving;
    deletingSheetRef.current = deletingSheet;
  }, [isCalendarOpen, showConfirmModal, pendingDeleteIndex, showDeleteSheetModal, saving, deletingSheet]);

  const [expandedIndex, setExpandedIndex] = useState<number | null>(() => {
    if (initialExpandedIndex !== undefined) return initialExpandedIndex;
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

  const [pendingNavigation, setPendingNavigation] = useState<{
    href: string;
    historyDelta?: number;
    returnFocusTo: HTMLElement | null;
  } | null>(null);
  const discardModalRef = useRef<HTMLDivElement | null>(null);
  const { registerGuard, proceedHistoryNavigation } = useUnsavedGuard();

  useModalFocusTrap({
    isOpen: showDeleteSheetModal,
    containerRef: deleteSheetModalRef,
    onClose: () => setShowDeleteSheetModal(false),
    canClose: !deletingSheet,
    returnFocusTo: deleteSheetBtnRef.current,
    fallbackFocusRef: cashInputRef,
    suppressFocusRestore: pendingNavigation !== null,
  });

  useModalFocusTrap({
    isOpen: pendingNavigation !== null,
    containerRef: discardModalRef,
    onClose: () => setPendingNavigation(null),
    returnFocusTo: pendingNavigation?.returnFocusTo ?? null,
    fallbackFocusRef: cashInputRef,
  });

  useModalFocusTrap({
    isOpen: pendingDeleteIndex !== null && Boolean(costLines[pendingDeleteIndex]),
    containerRef: deleteCostLineModalRef,
    onClose: () => setPendingDeleteIndex(null),
    fallbackFocusRef: cashInputRef,
    suppressFocusRestore: pendingNavigation !== null,
  });

  useModalFocusTrap({
    isOpen: showConfirmModal,
    containerRef: confirmSaveModalRef,
    onClose: () => {
      setSaveModalError(null);
      setShowConfirmModal(false);
    },
    canClose: !saving,
    fallbackFocusRef: cashInputRef,
    suppressFocusRestore: pendingNavigation !== null,
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedEditorRef = useRef<HTMLDivElement | null>(null);

  function clearSuccessTimer() {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }

  function dismissSuccessMessage() {
    clearSuccessTimer();
    setSuccessMessage(null);
  }

  function showSuccessMessage(message: string) {
    clearSuccessTimer();
    setSuccessMessage(message);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      setSuccessMessage(null);
    }, SUCCESS_BANNER_MS);
  }

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const [noteErrorIndex, setNoteErrorIndex] = useState<number | null>(initialNoteErrorIndex);
  const [costAmountErrorIndex, setCostAmountErrorIndex] = useState<number | null>(initialCostAmountErrorIndex);
  const noteErrorRef = useRef<HTMLInputElement | null>(null);
  const costAmountErrorRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (noteErrorIndex !== null) {
      noteErrorRef.current?.focus();
    }
  }, [noteErrorIndex]);

  useEffect(() => {
    if (costAmountErrorIndex !== null) {
      costAmountErrorRef.current?.focus();
    }
  }, [costAmountErrorIndex]);

  const touchedDuringSaveRef = useRef<Set<DraftField> | null>(null);
  const draftEverTouchedRef = useRef(false);

  function markTouchedDuringSave(field: DraftField) {
    touchedDuringSaveRef.current?.add(field);
    draftEverTouchedRef.current = true;
  }

  const [baseline, setBaseline] = useState(() => ({
    cashInput: initCashStr,
    tngInput: initTngStr,
    costLines: mergeCostLines(initialCostLines),
  }));

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

  const isModifiedRef = useRef(isModified);
  useEffect(() => {
    isModifiedRef.current = isModified;
  }, [isModified]);

  const prevDateRef = useRef(date);

  useEffect(() => {
    const cashStr = initialCashInput !== undefined ? initialCashInput : senToDecimalStr(initialCashSen);
    const tngStr = initialTngInput !== undefined ? initialTngInput : senToDecimalStr(initialTngSen);
    const mergedInitial = mergeCostLines(initialCostLines);
    const dateChanged = prevDateRef.current !== date;
    prevDateRef.current = date;

    if (!dateChanged && (isModifiedRef.current || draftEverTouchedRef.current)) {
      setBaseline({
        cashInput: cashStr,
        tngInput: tngStr,
        costLines: mergedInitial,
      });
      return;
    }

    draftEverTouchedRef.current = false;
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

  function handleRevert() {
    setCashInput(baseline.cashInput);
    setTngInput(baseline.tngInput);
    setCostLines(baseline.costLines);
    setErrorMessage(null);
    setNoteErrorIndex(null);
    setCostAmountErrorIndex(null);
  }

  const cashSen = tryParseSen(cashInput);
  const tngSen = tryParseSen(tngInput);
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

  const savedRevenueSen =
    (tryParseSen(baseline.cashInput) ?? 0n) + (tryParseSen(baseline.tngInput) ?? 0n);
  const savedCostSen = baseline.costLines.reduce(
    (acc, line) => acc + BigInt(line.amountSen),
    0n,
  );

  function handleCreateNewCostLine() {
    if (isClosed) return;
    markTouchedDuringSave("costLines");
    setNoteErrorIndex(null);
    setCostAmountErrorIndex(null);
    const result = createNewCostLine(costLines);
    setCostLines(result.lines);
    setExpandedIndex(result.expandedIndex);
    requestAnimationFrame(() => {
      expandedEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  function handleUpdateCostLine(index: number, patch: Partial<CostLineItem>) {
    markTouchedDuringSave("costLines");
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
    if (successMessage) dismissSuccessMessage();
    setExpandedIndex(index);
    setCostLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function handleRemoveCostLine(index: number) {
    if (isClosed) return;
    markTouchedDuringSave("costLines");
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
    markTouchedDuringSave("costLines");
    const result = toggleCostLineExpansion(costLines, index, expandedIndex, {
      noteErrorIndex,
      costAmountErrorIndex,
    });
    setCostLines(result.lines);
    setExpandedIndex(result.expandedIndex);
    setNoteErrorIndex(result.noteErrorIndex);
    setCostAmountErrorIndex(result.costAmountErrorIndex);
  }

  async function handleSave(): Promise<boolean> {
    if (saving || mutationInFlightRef.current !== null) return false;
    if (isClosed) return false;
    if (hasParseError || cashSen === null || tngSen === null) {
      setErrorMessage(t.invalidAmount);
      return false;
    }
    const { lines: consolidated, amountErrorIndex } = consolidateCostLinesForSave(costLines);
    setCostLines(consolidated);

    if (amountErrorIndex !== null) {
      setExpandedIndex(amountErrorIndex);
      setCostAmountErrorIndex(amountErrorIndex);
      setNoteErrorIndex(null);
      setErrorMessage(null);
      requestAnimationFrame(() => {
        costAmountErrorRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
        costAmountErrorRef.current?.focus();
      });
      return false;
    }
    setCostAmountErrorIndex(null);

    const missingNoteIdx = findMissingOtherNoteIndex(consolidated);
    if (missingNoteIdx !== -1) {
      setExpandedIndex(missingNoteIdx);
      setNoteErrorIndex(missingNoteIdx);
      setErrorMessage(null);
      requestAnimationFrame(() => {
        noteErrorRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
        noteErrorRef.current?.focus();
      });
      return false;
    }
    setNoteErrorIndex(null);
    setErrorMessage(null);
    setSaveModalError(null);
    dismissSuccessMessage();

    touchedDuringSaveRef.current = new Set<DraftField>();
    mutationInFlightRef.current = "save";
    setSaving(true);
    const savedDate = date;
    let navigatedAway = false;
    let succeeded = false;

    try {
      const res = await apiFetch("/api/sheets", {
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
        throw Object.assign(new Error(data.error ?? ""), { code: data.code });
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

        const navigatedAwayNow = prevDateRef.current !== savedDate;
        navigatedAway = navigatedAwayNow;

        const touched = touchedDuringSaveRef.current ?? new Set<DraftField>();

        if (!navigatedAway) setBaseline({
          cashInput: savedCash,
          tngInput: savedTng,
          costLines: savedCostLines,
        });

        if (!navigatedAway) {
          if (!touched.has("cash")) setCashInput(savedCash);
          if (!touched.has("tng")) setTngInput(savedTng);
          setCostLines((prev) =>
            rebaseCostLinesAfterSave(prev, savedCostLines, touched.has("costLines"))
          );
        }
      }

      if (!navigatedAway) {
        if (data.sheet) {
          setSavedSheet({ id: data.sheet.id, updatedAt: data.sheet.updatedAt });
        }
        showSuccessMessage(t.saveSuccess);
      }
      succeeded = true;
      startTransition(() => {
        refresh();
      });
    } catch (err) {
      const msg = translateApiError(apiErrorPayloadFrom(err), t);
      if (showConfirmModalRef.current) {
        setSaveModalError(msg);
        requestAnimationFrame(() => {
          confirmSaveModalRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        });
      } else {
        setErrorMessage(msg);
      }
    } finally {
      touchedDuringSaveRef.current = null;
      mutationInFlightRef.current = null;
      setSaving(false);
    }
    return succeeded;
  }

  async function handleDeleteSheet() {
    if (deletingSheet || isClosed || !savedSheet) return;
    if (mutationInFlightRef.current !== null) return;
    mutationInFlightRef.current = "delete";
    deleteSheetModalRef.current?.focus();
    setDeletingSheet(true);
    setDeleteSheetError(null);
    dismissSuccessMessage();
    const savedDate = date;
    let navigatedAway = false;

    try {
      const params = new URLSearchParams({
        date,
        id: String(savedSheet.id),
        updatedAt: savedSheet.updatedAt,
      });
      const res = await apiFetch(`/api/sheets?${params.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(new Error(data.error ?? ""), { code: data.code });
      }

      const navigatedAwayNow = prevDateRef.current !== savedDate;
      navigatedAway = navigatedAwayNow;

      if (!navigatedAway) {
        draftEverTouchedRef.current = false;
        setCashInput("");
        setTngInput("");
        setCostLines([]);
        setBaseline({ cashInput: "", tngInput: "", costLines: [] });
        setExpandedIndex(null);
        setNoteErrorIndex(null);
        setCostAmountErrorIndex(null);
        setSavedSheet(null);
        showSuccessMessage(t.deleteSheetSuccess);
      }
      setShowDeleteSheetModal(false);
      startTransition(() => {
        refresh();
      });
    } catch (err) {
      setDeleteSheetError(translateApiError(apiErrorPayloadFrom(err), t));
      if ((err as { code?: string }).code === "sheetChanged") {
        startTransition(() => {
          refresh();
        });
      }
      requestAnimationFrame(() => {
        deleteSheetModalRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      });
    } finally {
      mutationInFlightRef.current = null;
      setDeletingSheet(false);
    }
  }

  const isToday = date === todayKl;
  const isTodayRef = useRef(isToday);
  useEffect(() => {
    isTodayRef.current = isToday;
  }, [isToday]);

  // Guard persistent nav links, browser Back/Forward (popstate), and document unload when draft has unsaved edits
  useEffect(() => {
    return registerGuard({
      // Tapping the active Daily Sheet tab (`/`) while already viewing today (whether `/` or `/?date=<today>`) is a true no-op
      isSamePage: (targetHref) => targetHref === "/" && isTodayRef.current,
      isDirty: () =>
        isModifiedRef.current || mutationInFlightRef.current !== null || savingRef.current || deletingSheetRef.current,
      onRequestLeave: ({ href, historyDelta, triggerEl }) => {
        // Never stack Discard over an in-flight Save or Delete request: keep the active
        // mutation dialog as the sole modal & inert owner until the request settles.
        if (mutationInFlightRef.current !== null || savingRef.current || deletingSheetRef.current) {
          return;
        }

        // Close any open Daily Sheet dialog so Discard always owns the sole focus trap & inert layer,
        // and preserve each dialog's original live trigger button so Keep Editing / Escape never drops focus to <body>.
        const calendarWasOpen = isCalendarOpenRef.current;
        const confirmSaveWasOpen = showConfirmModalRef.current;
        const deleteCostWasOpen = pendingDeleteIndexRef.current !== null;
        const deleteSheetWasOpen = showDeleteSheetModalRef.current;

        if (calendarWasOpen) setIsCalendarOpen(false);
        if (confirmSaveWasOpen) setShowConfirmModal(false);
        if (deleteCostWasOpen) setPendingDeleteIndex(null);
        if (deleteSheetWasOpen) setShowDeleteSheetModal(false);

        const resolvedReturnFocus = calendarWasOpen
          ? dateBtnRef.current
          : confirmSaveWasOpen
            ? saveBtnRef.current
            : deleteCostWasOpen
              ? deleteCostLineTriggerRef.current
              : deleteSheetWasOpen
                ? deleteSheetBtnRef.current
                : (triggerEl ??
                  (document.activeElement instanceof HTMLElement ? document.activeElement : null));

        setPendingNavigation({
          href,
          historyDelta,
          returnFocusTo: resolvedReturnFocus ?? cashInputRef.current,
        });
      },
    });
  }, [registerGuard]);

  useEffect(() => {
    if (!isModified) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isModified]);

  function requestNavigateToDate(targetDate: string, triggerEl?: HTMLElement | null): boolean {
    if (mutationInFlightRef.current !== null || saving || deletingSheet) return false;
    if (targetDate === date) return true;
    const targetHref = targetDate === todayKl ? "/" : `/?date=${targetDate}`;
    if (isModified) {
      setPendingNavigation({
        href: targetHref,
        returnFocusTo:
          triggerEl ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : dateBtnRef.current),
      });
      return false;
    }
    router.push(targetHref);
    return true;
  }

  function navigateDate(offsetDays: number, triggerEl?: HTMLElement | null) {
    const current = new Date(`${date}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + offsetDays);
    const targetDate = current.toISOString().slice(0, 10);
    requestNavigateToDate(targetDate, triggerEl);
  }

  const canGoNext = date < todayKl;
  const weekday = formatWeekday(date, lang);

  const getCategoryLabel = (key: string) => {
    const found = categories.find((c) => c.key === key);
    return found ? found.label : key;
  };

  function handleSaveTrigger() {
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
        requestAnimationFrame(() => {
          costAmountErrorRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
          costAmountErrorRef.current?.focus();
        });
        return;
      }
    }
    const missingNoteIdx = findMissingOtherNoteIndex(costLines);
    if (missingNoteIdx !== -1) {
      setExpandedIndex(missingNoteIdx);
      setNoteErrorIndex(missingNoteIdx);
      setCostAmountErrorIndex(null);
      setErrorMessage(null);
      requestAnimationFrame(() => {
        noteErrorRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
        noteErrorRef.current?.focus();
      });
      return;
    }
    setCostAmountErrorIndex(null);
    setNoteErrorIndex(null);
    setSaveModalError(null);
    setExpandedIndex(null);
    setShowConfirmModal(true);
  }

  const sheetStatusBadge = isModified
    ? {
        label: t.unsavedChanges,
        className: "bg-finance-cost-light text-finance-cost border-finance-cost/30",
      }
    : sheetExists
    ? {
        label: t.savedState,
        className: "bg-finance-profit-light text-finance-profit border-finance-profit-border",
      }
    : {
        label: t.newSheetState,
        className: "bg-surface-subtle text-ink-muted border-surface-border",
      };

  const saveIsPrimary = !sheetExists || isModified;
  const isNeutralZeroPreview =
    !sheetExists && !isModified && totalRevenueSen === 0n && totalCostSen === 0n;

  return (
    <div className="space-y-1.5 sm:space-y-5">
      {/* Polite mutation status region mounted outside aria-busy dialogs so assistive tech announces immediately */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {saving ? t.saving : deletingSheet ? t.deleting : ""}
      </span>

      {/* Consistent Page Header + Compact Date Toolbar (Status pill always visible even at 320px) */}
      <div className="space-y-1.5 sm:space-y-3">
        <div className="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-ink-primary tracking-tight whitespace-nowrap">
                {t.dailySheetTitle}
              </h1>
              {isToday ? (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand-broccoli-light font-semibold text-brand-broccoli border border-brand-broccoli/20 whitespace-nowrap shrink-0">
                  {t.today}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={saving || deletingSheet}
                  onClick={() => requestNavigateToDate(todayKl)}
                  aria-label={t.jumpToToday}
                  className="group inline-flex items-center min-h-[48px] lg:min-h-[34px] -my-2.5 lg:my-0 focus:outline-none cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0"
                >
                  <span className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-full bg-surface text-brand-broccoli border border-brand-broccoli/35 shadow-control group-hover:bg-brand-broccoli-light group-focus-visible:ring-2 group-focus-visible:ring-brand-broccoli text-xs font-semibold transition-colors whitespace-nowrap">
                    <span aria-hidden="true">↺</span>
                    <span className="sm:hidden">{t.jumpToTodayShort}</span>
                    <span className="hidden sm:inline">{t.jumpToToday}</span>
                  </span>
                </button>
              )}
            </div>
            {!isClosed && (
              <span
                className={`lg:hidden text-[11px] font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${sheetStatusBadge.className}`}
              >
                {isModified ? (
                  <>
                    <span className="sm:hidden">{t.unsavedShort}</span>
                    <span className="hidden sm:inline">{sheetStatusBadge.label}</span>
                  </>
                ) : (
                  sheetStatusBadge.label
                )}
              </span>
            )}
          </div>

          {/* Compact Date Stepper with 48px touch targets on phones & tablets (CalendarPopover right-aligned flush to stepper) */}
          <div className="relative inline-flex items-center justify-between sm:justify-end gap-1 bg-surface border border-surface-border rounded-xl p-0.5 sm:p-1 shadow-card">
            <button
              type="button"
              disabled={saving || deletingSheet}
              onClick={() => navigateDate(-1)}
              aria-label={t.prevDay}
              title={t.prevDay}
              className="w-12 h-12 lg:w-10 lg:h-10 shrink-0 rounded-lg hover:bg-surface-subtle btn-tactile text-ink-secondary hover:text-ink-primary flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Date Display + Calendar Popover Trigger */}
            <div className="flex items-center justify-center min-w-0">
              <button
                ref={dateBtnRef}
                type="button"
                disabled={saving || deletingSheet}
                onClick={() => setIsCalendarOpen((prev) => !prev)}
                aria-expanded={isCalendarOpen}
                aria-haspopup="dialog"
                className="group cursor-pointer h-12 lg:h-10 px-2 sm:px-3 rounded-lg hover:bg-surface-subtle transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli flex items-center gap-1.5 sm:gap-2 whitespace-nowrap"
                title={t.datePickerLabel}
              >
                <svg aria-hidden="true" className="w-4 h-4 text-ink-muted group-hover:text-brand-broccoli transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                <span className="text-sm sm:text-base font-bold text-ink-primary group-hover:text-brand-broccoli transition-colors num-tabular">
                  {date}
                </span>
                {weekday && (
                  <span className="text-xs font-medium text-ink-muted">
                    {weekday}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              disabled={!canGoNext || saving || deletingSheet}
              onClick={() => navigateDate(1)}
              aria-label={t.nextDay}
              title={t.nextDay}
              className="w-12 h-12 lg:w-10 lg:h-10 shrink-0 rounded-lg hover:bg-surface-subtle btn-tactile text-ink-secondary hover:text-ink-primary flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <CalendarPopover
              date={date}
              todayKl={todayKl}
              isOpen={isCalendarOpen}
              triggerRef={dateBtnRef}
              suppressFocusRestore={pendingNavigation !== null}
              onClose={() => setIsCalendarOpen(false)}
              onSelectDate={(newDate) => {
                return requestNavigateToDate(newDate, dateBtnRef.current);
              }}
            />
          </div>
        </div>

        {isClosed && (
          <div className="py-2.5 px-4 rounded-xl bg-status-closed-bg border border-status-closed/20 flex items-center gap-2 text-sm font-semibold text-status-closed">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>{t.monthLocked}</span>
          </div>
        )}
      </div>

      {/* Main Responsive 2-Column Workspace (lg:grid-rows-[auto_1fr] keeps Delete directly under Day Summary) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-2 sm:gap-5 items-start">
        {/* Left Column: Revenue Entry & Daily Costs */}
        <div className="lg:col-span-7 lg:row-span-2 space-y-2 sm:space-y-5">
          {/* Section 1: Revenue Entry Card (uniform px-3.5 mobile edge; compact vertical rhythm for 320x660 first-paint clearance) */}
          <section aria-label={t.revenueTitle} className="bg-surface border border-surface-border rounded-2xl px-3.5 py-2 sm:p-6 shadow-card space-y-1.5 sm:space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-base font-bold text-ink-primary whitespace-nowrap">
                {t.revenueTitle}
              </h2>
              <span className="text-xs sm:text-sm font-medium text-ink-muted num-tabular whitespace-nowrap">
                {t.totalRevenue}:{" "}
                <span className="font-bold text-ink-primary">
                  {totalRevenueSen !== null ? <MoneyValue sen={totalRevenueSen} /> : "—"}
                </span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-4">
              {/* Cash Revenue Input */}
              <div>
                <div className="flex items-center gap-2 mb-1 sm:mb-2">
                  <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-channel-cash-light text-channel-cash flex items-center justify-center shrink-0">
                    <CashIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </span>
                  <label htmlFor="cash-input" className="text-sm font-semibold text-ink-primary">
                    {t.cashRevenue}
                  </label>
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-sm font-bold text-channel-cash select-none">
                    RM
                  </span>
                  <input
                    ref={cashInputRef}
                    id="cash-input"
                    type="text"
                    inputMode="decimal"
                    disabled={isClosed || saving}
                    value={cashInput}
                    onChange={(e) => {
                      const sanitized = sanitizeMoneyInput(e.target.value);
                      if (sanitized !== null) {
                        markTouchedDuringSave("cash");
                        setCashInput(sanitized);
                        if (errorMessage) setErrorMessage(null);
                        if (successMessage) dismissSuccessMessage();
                      }
                    }}
                    placeholder="0.00"
                    className={`w-full h-12 sm:h-14 pl-11 pr-3.5 scroll-mb-40 rounded-xl bg-surface-input border ${
                      cashError ? "border-finance-loss" : "border-surface-border-strong"
                    } text-lg sm:text-xl font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface ${
                      cashError
                        ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                        : "focus:border-channel-cash focus-visible:ring-channel-cash/30"
                    } focus-visible:ring-2 disabled:opacity-60 transition-colors`}
                  />
                </div>
                {cashError && (
                  <div role="alert" className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium">
                    <span>{t.invalidAmount}</span>
                  </div>
                )}
              </div>

              {/* TnG Revenue Input */}
              <div>
                <div className="flex items-center gap-2 mb-1 sm:mb-2">
                  <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-channel-tng-light text-channel-tng flex items-center justify-center shrink-0">
                    <TngIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </span>
                  <label htmlFor="tng-input" className="text-sm font-semibold text-ink-primary">
                    {t.tngRevenue}
                  </label>
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-sm font-bold text-channel-tng select-none">
                    RM
                  </span>
                  <input
                    id="tng-input"
                    type="text"
                    inputMode="decimal"
                    disabled={isClosed || saving}
                    value={tngInput}
                    onChange={(e) => {
                      const sanitized = sanitizeMoneyInput(e.target.value);
                      if (sanitized !== null) {
                        markTouchedDuringSave("tng");
                        setTngInput(sanitized);
                        if (errorMessage) setErrorMessage(null);
                        if (successMessage) dismissSuccessMessage();
                      }
                    }}
                    placeholder="0.00"
                    className={`w-full h-12 sm:h-14 pl-11 pr-3.5 scroll-mb-40 rounded-xl bg-surface-input border ${
                      tngError ? "border-finance-loss" : "border-surface-border-strong"
                    } text-lg sm:text-xl font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface ${
                      tngError
                        ? "focus:border-finance-loss focus-visible:ring-finance-loss/40"
                        : "focus:border-channel-tng focus-visible:ring-channel-tng/30"
                    } focus-visible:ring-2 disabled:opacity-60 transition-colors`}
                  />
                </div>
                {tngError && (
                  <div role="alert" className="mt-1.5 py-1.5 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium">
                    <span>{t.invalidAmount}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 2: Daily Costs Card (matches Operating Expenses card: title + total in header, full-width 48px Add button in footer) */}
          <section aria-label={t.costsTitle} className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
            <div className="px-3.5 py-2 sm:px-6 sm:py-4 border-b border-surface-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-bold text-ink-primary whitespace-nowrap">
                  {t.costsTitle}
                </h2>
                <span className="sr-only">{t.costCategory}</span>
              </div>
              <span className="text-sm font-bold text-ink-secondary num-tabular whitespace-nowrap shrink-0">
                <MoneyValue sen={totalCostSen} />
              </span>
            </div>

            {/* Cost Lines List — Separate accessible expand & 48px delete targets, unified category icons */}
            {costLines.length > 0 ? (
              <div className="divide-y divide-surface-border">
                {costLines.map((line, idx) => {
                  const isExpanded = expandedIndex === idx;
                  const token = COST_CATEGORY_TOKENS[line.category];
                  const catLabel = getCategoryLabel(line.category);
                  return (
                    <div
                      key={getCostLineKey(line, idx)}
                      className={`transition-colors ${
                        isExpanded ? "bg-surface-subtle/35" : "bg-surface"
                      }`}
                    >
                      {/* Summary Row: Two Sibling Buttons (No Nested Interactive Controls) */}
                      <div className="flex items-center">
                        <button
                          type="button"
                          disabled={isClosed}
                          onClick={() => {
                            if (isClosed) return;
                            handleToggleCostLine(idx);
                          }}
                          aria-expanded={isExpanded}
                          className={`flex-1 min-w-0 min-h-[48px] sm:min-h-[60px] pl-3.5 sm:pl-6 pr-1 sm:pr-2 py-1.5 sm:py-3 scroll-mb-40 flex items-center justify-between gap-2 sm:gap-3 text-left select-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-broccoli ${
                            isClosed ? "cursor-default" : "cursor-pointer hover:bg-surface-subtle/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <span
                              className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: token.softVar,
                                color: token.colorVar,
                              }}
                              aria-hidden="true"
                            >
                              <CostCategoryIcon category={line.category} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-ink-primary truncate">
                                {catLabel}
                              </div>
                              {line.note && (
                                <span className="block text-xs text-ink-muted break-words whitespace-normal leading-snug mt-0.5">
                                  {line.note}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                            <span
                              className={`${amountSizeClass(
                                formatDisplayMyr(BigInt(line.amountSen)),
                                "text-xs",
                                "text-sm sm:text-base"
                              )} font-bold text-ink-primary whitespace-nowrap`}
                            >
                              <MoneyValue sen={BigInt(line.amountSen)} />
                            </span>

                            {!isClosed && (
                              <svg
                                aria-hidden="true"
                                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-ink-muted transition-transform duration-150 shrink-0 ${
                                  isExpanded ? "rotate-180 text-brand-broccoli" : ""
                                }`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </div>
                        </button>

                        {!isClosed && (
                          <div className="pr-0.5 sm:pr-3 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                deleteCostLineTriggerRef.current = e.currentTarget;
                                setPendingDeleteIndex(idx);
                              }}
                              aria-label={t.delete}
                              title={`${t.delete} ${catLabel}`}
                              className="w-12 h-12 scroll-mb-40 rounded-xl hover:bg-finance-loss-light text-ink-muted hover:text-finance-loss flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Expanded Editor */}
                      {isExpanded && !isClosed && (
                        <div
                          ref={expandedEditorRef}
                          className="px-3.5 sm:px-6 pb-5 pt-3 border-t border-surface-border/70 space-y-4 scroll-mb-40"
                        >
                          {/* Category Pills */}
                          <div>
                            <span className="block text-xs font-semibold text-ink-muted mb-2">
                              {t.costCategory ?? t.selectCategory}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {categories.map((cat) => {
                                const isSelected = line.category === cat.key;
                                return (
                                  <button
                                    key={cat.key}
                                    type="button"
                                    disabled={isClosed || saving}
                                    onClick={() => handleUpdateCostLine(idx, { category: cat.key })}
                                    className={`min-h-[48px] lg:min-h-[44px] px-3.5 py-2 scroll-mb-40 rounded-xl text-sm font-semibold border btn-tactile select-none flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli disabled:opacity-50 cursor-pointer ${
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

                          {/* Amount & Note Inputs */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label htmlFor={`cost-amount-input-${idx}`} className="block text-xs font-semibold text-ink-secondary mb-1.5">
                                {t.amount}
                              </label>
                              <div className="relative flex items-center">
                                <span className="absolute left-3.5 text-sm font-bold text-ink-muted select-none">
                                  RM
                                </span>
                                <input
                                  id={`cost-amount-input-${idx}`}
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isClosed || saving}
                                  value={line.amountInput ?? (line.amountSen > 0 ? senToDecimalStr(line.amountSen) : "")}
                                  ref={idx === costAmountErrorIndex ? costAmountErrorRef : undefined}
                                  aria-invalid={idx === costAmountErrorIndex || undefined}
                                  aria-describedby={idx === costAmountErrorIndex ? `cost-amount-error-${idx}` : undefined}
                                  onChange={(e) => {
                                    const sanitized = sanitizeMoneyInput(e.target.value);
                                    if (sanitized !== null) {
                                      const sen = tryParseSen(sanitized);
                                      handleUpdateCostLine(idx, {
                                        amountInput: sanitized,
                                        amountSen: Number(sen ?? 0n),
                                      });
                                    }
                                  }}
                                  onFocus={() => setExpandedIndex(idx)}
                                  placeholder="0.00"
                                  className={`w-full h-12 pl-11 pr-3 scroll-mb-40 rounded-xl bg-surface-input border text-base font-bold text-ink-primary num-tabular focus:outline-none focus:bg-surface focus-visible:ring-2 transition-colors ${
                                    idx === costAmountErrorIndex
                                      ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                      : "border-surface-border-strong focus:border-brand-broccoli focus-visible:ring-brand-broccoli/30"
                                  }`}
                                />
                              </div>
                              {idx === costAmountErrorIndex && (
                                <div
                                  id={`cost-amount-error-${idx}`}
                                  role="alert"
                                  className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium"
                                >
                                  <span>{t.invalidAmount}</span>
                                </div>
                              )}
                            </div>

                            <div>
                              <label htmlFor={`cost-note-input-${idx}`} className="block text-xs font-semibold text-ink-secondary mb-1.5">
                                {t.note} {line.category === "other" && <span className="text-finance-loss">*</span>}
                              </label>
                              <input
                                id={`cost-note-input-${idx}`}
                                type="text"
                                disabled={isClosed || saving}
                                value={line.note ?? ""}
                                ref={idx === noteErrorIndex ? noteErrorRef : undefined}
                                aria-invalid={idx === noteErrorIndex || undefined}
                                aria-describedby={idx === noteErrorIndex ? `other-note-error-${idx}` : undefined}
                                onChange={(e) => {
                                  handleUpdateCostLine(idx, { note: e.target.value });
                                }}
                                onFocus={() => setExpandedIndex(idx)}
                                placeholder={line.category === "other" ? t.noteRequired : t.noteOptional}
                                className={`w-full h-12 px-3.5 scroll-mb-40 rounded-xl bg-surface-input border text-sm text-ink-primary focus:outline-none focus:bg-surface focus-visible:ring-2 transition-colors ${
                                  idx === noteErrorIndex
                                    ? "border-finance-loss focus:border-finance-loss focus-visible:ring-finance-loss/40"
                                    : "border-surface-border-strong focus:border-brand-broccoli focus-visible:ring-brand-broccoli/30"
                                }`}
                              />
                              {idx === noteErrorIndex && (
                                <p
                                  id={`other-note-error-${idx}`}
                                  className="mt-1.5 py-1.5 px-2.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-medium"
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
            ) : (
              <div className="px-4 py-1 sm:px-5 sm:py-5 text-center text-xs sm:text-sm text-ink-muted">
                {t.noCostsRecorded}
              </div>
            )}

            {/* Add Cost Line Footer Action — consistent with Operating Expenses card & uniform px-3.5 mobile edge */}
            {!isClosed && (
              <div className="px-3.5 py-2 sm:p-4 sm:px-6 border-t border-surface-border bg-surface-subtle/30">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCreateNewCostLine}
                  className="w-full min-h-[48px] px-4 scroll-mb-40 rounded-xl bg-brand-broccoli-light hover:bg-brand-broccoli/15 border border-brand-broccoli/25 shadow-control text-brand-broccoli font-semibold text-sm btn-tactile flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span>{t.addCostLine}</span>
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Floating Sticky Summary & Save Card on Mobile/Tablet (identical vertical padding in stuck & floating states = 0px jump), Sticky Sidebar Card on Desktop (lg+) */}
        <div
          data-testid="floating-save-card"
          data-stuck={isDockStuck ? "true" : "false"}
          className={`sticky bottom-[var(--mobile-nav-height)] z-30 pt-1.5 pb-1.5 sm:pt-2.5 sm:pb-2.5 border-t transition-colors lg:mx-0 lg:p-0 lg:bg-transparent lg:backdrop-blur-none lg:border-0 lg:top-8 lg:bottom-auto lg:col-span-5 lg:col-start-8 space-y-2.5 ${
            isDockStuck
              ? "-mx-4 px-4 sm:-mx-6 sm:px-6 bg-surface-canvas/95 backdrop-blur-md border-surface-border/80"
              : "border-transparent"
          }`}
        >
            {errorMessage && (
              <div role="alert" className="py-2.5 px-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-sm text-finance-loss font-semibold flex items-start justify-between gap-2 shadow-card animate-slide-down">
                <div className="flex items-start gap-2 min-w-0">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-finance-loss" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="break-words whitespace-normal">{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-xs font-bold ml-2 text-ink-muted hover:text-finance-loss w-7 h-7 flex items-center justify-center rounded-lg shrink-0 cursor-pointer"
                  aria-label={t.closeLabel}
                >
                  ✕
                </button>
              </div>
            )}

            {successMessage && (
              <div className="py-2.5 px-4 rounded-xl bg-brand-broccoli-light border border-brand-broccoli/30 text-sm text-brand-broccoli font-semibold flex items-center justify-between shadow-card animate-slide-down">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 shrink-0 text-brand-broccoli" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="truncate">{successMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissSuccessMessage}
                  className="text-xs font-bold ml-2 text-ink-muted hover:text-brand-broccoli w-7 h-7 flex items-center justify-center rounded-lg shrink-0 cursor-pointer"
                  aria-label={t.closeLabel}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="bg-surface/95 backdrop-blur-md border border-surface-border-strong/45 lg:border-surface-border rounded-2xl shadow-popover lg:bg-surface lg:backdrop-blur-none lg:shadow-card">
              <div className="px-3.5 py-2 sm:px-5 sm:py-3 lg:p-5 lg:space-y-4">
                {/* Desktop Equation Breakdown */}
                <div className="hidden lg:block space-y-2.5 pb-4 border-b border-surface-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-primary">
                      {t.daySummaryTitle}
                    </span>
                    {!isClosed && (
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${sheetStatusBadge.className}`}
                      >
                        {sheetStatusBadge.label}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">{t.totalRevenue}</span>
                    <span className="font-semibold text-ink-primary num-tabular">
                      {totalRevenueSen !== null ? <MoneyValue sen={totalRevenueSen} /> : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">{t.totalCosts}</span>
                    <span className="font-semibold text-ink-secondary num-tabular">
                      {totalCostSen > 0n ? "\u2212" : ""}
                      <MoneyValue sen={totalCostSen} />
                    </span>
                  </div>
                </div>

                {/* Day Result + Scrolled Unsaved Indicator + 48px Undo & Save CTAs (roomy at 320px even when dirty) */}
                <div className="flex lg:flex-col items-center lg:items-stretch justify-between gap-2 lg:gap-4">
                  <div className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        data-testid="save-dock-label"
                        className="text-xs sm:text-sm text-ink-muted font-medium whitespace-nowrap"
                      >
                        <span className="sm:hidden">{t.grossProfitShort}</span>
                        <span className="hidden sm:inline">{t.grossProfit}</span>
                      </span>
                      {!isClosed && isModified && isDockStuck && (
                        <span
                          className="lg:hidden inline-flex items-center gap-1 text-[11px] font-semibold text-finance-cost whitespace-nowrap shrink-0"
                          title={t.unsavedChanges}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-finance-cost shrink-0" aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only">{t.unsavedShort}</span>
                        </span>
                      )}
                    </div>
                    <div
                      className={`${amountSizeClass(
                        grossProfitSen !== null ? formatDisplayMyr(grossProfitSen) : "—",
                        "text-base",
                        "text-xl"
                      )} lg:text-2xl font-bold mt-0.5 lg:mt-0 ${
                        isNeutralZeroPreview
                          ? "text-ink-muted"
                          : grossProfitSen !== null && grossProfitSen >= 0n
                          ? "text-finance-profit"
                          : "text-finance-loss"
                      }`}
                    >
                      {grossProfitSen !== null ? (
                        <MoneyValue sen={grossProfitSen} variant="metric" />
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>

                  {!isClosed && (
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 lg:w-full">
                      {isModified && (
                        <button
                          type="button"
                          onClick={handleRevert}
                          disabled={saving}
                          title={t.undoChanges}
                          aria-label={t.undoChanges}
                          className="h-12 px-2.5 sm:px-3.5 shrink-0 rounded-xl border border-surface-border-strong bg-surface hover:bg-surface-subtle shadow-control text-ink-secondary hover:text-ink-primary btn-tactile inline-flex items-center justify-center gap-1 sm:gap-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.1" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                          </svg>
                          <span>{t.undoShort}</span>
                        </button>
                      )}

                      <button
                        ref={saveBtnRef}
                        type="button"
                        disabled={saving || hasParseError}
                        onClick={handleSaveTrigger}
                        aria-label={t.saveSheet}
                        className={`h-12 px-3.5 sm:px-5 lg:px-6 lg:flex-1 rounded-xl btn-tactile font-semibold text-sm tracking-wide flex items-center justify-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli focus-visible:ring-offset-1 cursor-pointer whitespace-nowrap ${
                          saveIsPrimary
                            ? "bg-brand-cta hover:bg-brand-cta-hover text-brand-cta-ink shadow-card"
                            : "bg-surface-subtle hover:bg-surface-hover text-ink-muted hover:text-ink-secondary border border-surface-border shadow-none"
                        }`}
                      >
                        {saving ? (
                          <span>{t.saving}</span>
                        ) : (
                          <>
                            <span className="sm:hidden">{t.saveSheetShort}</span>
                            <span className="hidden sm:inline">{t.saveSheet}</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 1px sentinel in normal flow right below the Save card so dock border/scrim renders only when actively stuck */}
          <div
            ref={dockSentinelRef}
            aria-hidden="true"
            className="h-px w-full -mt-2 sm:-mt-5 pointer-events-none lg:hidden"
          />

          {/* Quiet De-Escalated Destructive Action — Directly under Day Summary (centered, zero chasm) */}
          {sheetExists && (
            <div className="lg:col-span-5 lg:col-start-8 pt-1 pb-2 flex justify-center">
              <button
                ref={deleteSheetBtnRef}
                type="button"
                disabled={
                  isClosed ||
                  saving ||
                  deletingSheet ||
                  !canOpenDeleteSheetModal({ showConfirmModal, pendingDeleteIndex })
                }
                onClick={() => {
                  if (!canOpenDeleteSheetModal({ showConfirmModal, pendingDeleteIndex })) return;
                  setErrorMessage(null);
                  setDeleteSheetError(null);
                  setShowDeleteSheetModal(true);
                }}
                className="min-h-[48px] lg:min-h-[44px] px-4 scroll-mb-40 rounded-xl text-finance-loss/85 hover:text-finance-loss hover:bg-finance-loss-light border border-transparent hover:border-finance-loss-border transition-colors font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
              >
                <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>{t.deleteSheetBtn}</span>
              </button>
            </div>
          )}
      </div>

      {/* Delete Daily Sheet Confirmation Modal */}
      {showDeleteSheetModal && (
        <div
          ref={deleteSheetModalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-busy={deletingSheet}
          aria-labelledby="confirm-delete-sheet-title"
          aria-describedby="confirm-delete-sheet-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down focus:outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingSheet) setShowDeleteSheetModal(false);
          }}
        >
          <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface rounded-2xl p-6 shadow-popover border border-surface-border space-y-5">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-finance-loss-light border border-finance-loss-border text-finance-loss flex items-center justify-center shrink-0 select-none">
                <svg aria-hidden="true" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v9m0 5h.01" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 id="confirm-delete-sheet-title" className="text-lg font-bold text-ink-primary">
                  {t.confirmDeleteSheetTitle}
                </h3>
                <p id="confirm-delete-sheet-desc" className="text-[13px] text-ink-muted mt-1 leading-relaxed">
                  {t.confirmDeleteSheetDesc}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-subtle border border-surface-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{t.sheetDate}</span>
                <span className="font-bold text-ink-primary num-tabular">{date}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{t.savedTotalRevenue}</span>
                <MoneyValue sen={savedRevenueSen} className="font-bold text-ink-primary" />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{t.savedTotalCosts}</span>
                <MoneyValue sen={savedCostSen} className="font-bold text-finance-loss" />
              </div>
            </div>

            {deleteSheetError && (
              <p role="alert" className="text-sm font-semibold text-finance-loss text-center break-words whitespace-normal">
                {deleteSheetError}
              </p>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                autoFocus
                disabled={deletingSheet}
                onClick={() => setShowDeleteSheetModal(false)}
                className="flex-1 min-h-[48px] rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={deletingSheet}
                onClick={handleDeleteSheet}
                className="flex-1 min-h-[48px] rounded-xl bg-danger-cta hover:bg-danger-cta-hover btn-tactile text-danger-cta-ink font-semibold text-sm flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer disabled:opacity-50"
              >
                {deletingSheet ? t.deleting : t.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Cost Line Confirmation Modal (viewport-bounded with scrollable long notes so actions stay reachable) */}
      {pendingDeleteIndex !== null && costLines[pendingDeleteIndex] && (
        <div
          ref={deleteCostLineModalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-cost-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down focus:outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDeleteIndex(null);
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
                <h3 id="confirm-delete-cost-title" className="text-base font-bold text-ink-primary">
                  {t.confirmDeleteItemTitle}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {t.confirmDeleteItemDesc}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface border border-surface-border text-ink-secondary whitespace-nowrap">
                  {getCategoryLabel(costLines[pendingDeleteIndex].category)}
                </span>
                <span
                  className={`${amountSizeClass(
                    formatDisplayMyr(BigInt(costLines[pendingDeleteIndex].amountSen)),
                    "text-xs",
                    "text-base"
                  )} font-bold text-finance-loss whitespace-nowrap`}
                >
                  <MoneyValue sen={BigInt(costLines[pendingDeleteIndex].amountSen)} />
                </span>
              </div>
              {costLines[pendingDeleteIndex].note && (
                <p
                  tabIndex={0}
                  aria-label={t.note}
                  className="min-h-0 flex-1 max-h-36 overflow-y-auto px-2.5 py-2 rounded-lg bg-surface/75 border border-surface-border/80 text-xs text-ink-secondary break-words whitespace-normal leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                >
                  {costLines[pendingDeleteIndex].note}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2.5 pt-1 shrink-0">
              <button
                type="button"
                onClick={() => setPendingDeleteIndex(null)}
                className="flex-1 min-h-[48px] rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRemoveCostLine(pendingDeleteIndex);
                  setPendingDeleteIndex(null);
                }}
                className="flex-1 min-h-[48px] rounded-xl bg-danger-cta hover:bg-danger-cta-hover btn-tactile text-danger-cta-ink font-semibold text-sm flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
              >
                {t.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Draft Guard Modal (inert background, focus trap, focus return) */}
      {pendingNavigation !== null && (
        <div
          ref={discardModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-unsaved-title"
          aria-describedby="discard-unsaved-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingNavigation(null);
          }}
        >
          <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface rounded-2xl p-6 shadow-popover border border-surface-border space-y-5">
            <div className="space-y-1.5">
              <h3 id="discard-unsaved-title" className="text-lg font-bold text-ink-primary">
                {t.discardUnsavedTitle}
              </h3>
              <p id="discard-unsaved-desc" className="text-[13px] text-ink-muted leading-relaxed">
                {t.discardUnsavedDesc}
              </p>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setPendingNavigation(null)}
                className="flex-1 min-h-[48px] rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                {t.keepEditingBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingNavigation;
                  setPendingNavigation(null);
                  if (typeof target.historyDelta === "number") {
                    proceedHistoryNavigation(target.historyDelta);
                  } else {
                    router.push(target.href);
                  }
                }}
                className="flex-1 min-h-[48px] rounded-xl bg-danger-cta hover:bg-danger-cta-hover btn-tactile text-danger-cta-ink font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-finance-loss/60 cursor-pointer"
              >
                {t.discardAndSwitchBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Confirmation Modal (stays mounted with proactive focus & live status during in-flight Save) */}
      {showConfirmModal && (
        <div
          ref={confirmSaveModalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-busy={saving}
          aria-labelledby="confirm-modal-title"
          aria-describedby="confirm-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-slide-down focus:outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) {
              setSaveModalError(null);
              setShowConfirmModal(false);
            }
          }}
        >
          <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface rounded-2xl p-6 shadow-popover border border-surface-border space-y-5">
            <div className="space-y-1">
              <h3 id="confirm-modal-title" className="text-lg font-bold text-ink-primary">
                {t.confirmSaveTitle}
              </h3>
              <p id="confirm-modal-desc" className="text-[13px] text-ink-muted leading-relaxed">
                {t.confirmSaveDesc}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-subtle border border-surface-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{t.totalRevenue}</span>
                <span className="font-bold text-ink-primary num-tabular">
                  {totalRevenueSen !== null ? <MoneyValue sen={totalRevenueSen} /> : "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">{t.totalCosts}</span>
                <MoneyValue sen={totalCostSen} className="font-bold text-ink-primary" />
              </div>
              <div className="pt-2.5 border-t border-surface-border flex justify-between text-base">
                <span className="font-bold text-ink-primary">{t.grossProfit}</span>
                <span
                  className={`font-bold num-tabular ${
                    grossProfitSen !== null && grossProfitSen >= 0n ? "text-finance-profit" : "text-finance-loss"
                  }`}
                >
                  {grossProfitSen !== null ? <MoneyValue sen={grossProfitSen} /> : "—"}
                </span>
              </div>
            </div>

            {saveModalError && (
              <p role="alert" className="text-sm font-semibold text-finance-loss text-center break-words whitespace-normal">
                {saveModalError}
              </p>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setSaveModalError(null);
                  setShowConfirmModal(false);
                }}
                className="flex-1 min-h-[48px] rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary font-semibold text-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  confirmSaveModalRef.current?.focus();
                  const ok = await handleSave();
                  if (ok) {
                    setSaveModalError(null);
                    setShowConfirmModal(false);
                  }
                }}
                className="flex-1 min-h-[48px] rounded-xl bg-brand-cta hover:bg-brand-cta-hover btn-tactile text-brand-cta-ink font-semibold text-sm flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer disabled:opacity-50"
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
