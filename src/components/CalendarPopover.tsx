"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { acquireDocumentScrollLock } from "@/lib/use-modal-focus-trap";

interface CalendarPopoverProps {
  date: string; // YYYY-MM-DD
  todayKl: string; // YYYY-MM-DD
  isOpen: boolean;
  onClose: () => void;
  /** Return `false` if the parent opened another modal (e.g. unsaved guard) so focus is not pulled back to the trigger. */
  onSelectDate: (date: string) => boolean | void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** When true, skip returning focus to trigger on close (e.g., parent handed focus to Discard modal on popstate). */
  suppressFocusRestore?: boolean;
}

export function CalendarPopover({
  date,
  todayKl,
  isOpen,
  onClose,
  onSelectDate,
  triggerRef,
  suppressFocusRestore = false,
}: CalendarPopoverProps) {
  const { lang, t } = useI18n();
  const dialogRootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const skipFocusRestoreRef = useRef(false);
  const suppressFocusRestoreRef = useRef(suppressFocusRestore);
  suppressFocusRestoreRef.current = suppressFocusRestore;

  const [initialYear, initialMonth, initialDay] = date.split("-").map(Number);
  const [viewYear, setViewYear] = useState<number>(initialYear || 2026);
  const [viewMonth, setViewMonth] = useState<number>(
    initialMonth !== undefined ? initialMonth - 1 : 8,
  );
  const [activeDay, setActiveDay] = useState<number>(initialDay || 1);

  useEffect(() => {
    if (isOpen) {
      const [y, m, d] = date.split("-").map(Number);
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
        setActiveDay(d || 1);
      }
      skipFocusRestoreRef.current = false;
    }
  }, [isOpen, date]);

  // Make background inert & lock document scroll while modal dialog is open, move focus in, and restore on close
  useEffect(() => {
    if (!isOpen) return;

    const releaseScrollLock = acquireDocumentScrollLock();
    const inerted: HTMLElement[] = [];
    const root = dialogRootRef.current;
    const returnTrigger = triggerRef?.current ?? null;
    if (root) {
      for (let node: HTMLElement | null = root; node && node !== document.body; node = node.parentElement) {
        for (const sibling of Array.from(node.parentElement?.children ?? [])) {
          if (
            sibling !== node &&
            sibling instanceof HTMLElement &&
            !sibling.hasAttribute("data-inert-exempt") &&
            !sibling.inert
          ) {
            sibling.inert = true;
            inerted.push(sibling);
          }
        }
      }
    }

    const syncScrollCues = (grid: HTMLElement) => {
      setCanScrollUp(grid.scrollTop > 2);
      setCanScrollDown(grid.scrollTop + grid.clientHeight < grid.scrollHeight - 2);
    };

    const centerTargetInGrid = (target: HTMLElement | null) => {
      const grid = gridScrollRef.current;
      if (!grid || !target) return;
      if (grid.scrollHeight > grid.clientHeight + 1) {
        const targetRect = target.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const relTop = targetRect.top - gridRect.top + grid.scrollTop;
        const innerGrid = grid.firstElementChild as HTMLElement | null;
        const rowGap = innerGrid ? parseFloat(getComputedStyle(innerGrid).rowGap || "0") || 0 : 0;
        const rowStride = targetRect.height + rowGap;
        const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
        let nextScrollTop = Math.max(0, relTop - (grid.clientHeight - targetRect.height) / 2);

        // Snap to whole week rows so the top visible row isn't sliced in half
        if (rowStride > 0) {
          let snapped = Math.round(nextScrollTop / rowStride) * rowStride;
          if (snapped > maxScroll) {
            snapped = Math.floor(maxScroll / rowStride) * rowStride;
          }
          // Ensure the target cell remains completely visible after row snapping
          if (relTop < snapped) {
            snapped = Math.floor(relTop / rowStride) * rowStride;
          } else if (relTop + targetRect.height > snapped + grid.clientHeight) {
            snapped = Math.min(
              maxScroll,
              Math.ceil((relTop + targetRect.height - grid.clientHeight) / rowStride) * rowStride
            );
          }
          nextScrollTop = Math.max(0, Math.min(maxScroll, snapped));
        }

        grid.scrollTop = nextScrollTop;
      }
      syncScrollCues(grid);
    };

    const raf = requestAnimationFrame(() => {
      const selectedBtn = popoverRef.current?.querySelector<HTMLButtonElement>(
        `button[aria-label="${date}"]:not(:disabled)`
      );
      const firstEnabled = Array.from(
        popoverRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
      ).find((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
      const target = selectedBtn ?? firstEnabled;
      target?.focus();
      centerTargetInGrid(target ?? null);
    });

    const gridEl = gridScrollRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && gridEl
        ? new ResizeObserver(() => {
            const focusedInGrid =
              document.activeElement instanceof HTMLButtonElement &&
              gridEl.contains(document.activeElement)
                ? document.activeElement
                : null;
            const rovingTarget =
              popoverRef.current?.querySelector<HTMLButtonElement>(
                'button[data-calendar-day][tabindex="0"]:not(:disabled)'
              ) ?? null;
            const selectedTarget =
              popoverRef.current?.querySelector<HTMLButtonElement>(
                `button[aria-label="${date}"]:not(:disabled)`
              ) ?? null;
            centerTargetInGrid(focusedInGrid ?? rovingTarget ?? selectedTarget);
          })
        : null;
    if (gridEl && ro) {
      ro.observe(gridEl);
      if (gridEl.firstElementChild) {
        ro.observe(gridEl.firstElementChild);
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      releaseScrollLock();
      for (const el of inerted) el.inert = false;
      if (!skipFocusRestoreRef.current && !suppressFocusRestoreRef.current) {
        returnTrigger?.focus({ preventScroll: true });
      }
      skipFocusRestoreRef.current = false;
    };
  }, [isOpen, date, triggerRef]);

  // Re-sync scroll overflow cues whenever paging between 5-row and 6-row months
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      const grid = gridScrollRef.current;
      if (!grid) return;
      setCanScrollUp(grid.scrollTop > 2);
      setCanScrollDown(grid.scrollTop + grid.clientHeight < grid.scrollHeight - 2);
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, viewYear, viewMonth]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && popoverRef.current) {
        const focusables = Array.from(
          popoverRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled):not([tabindex="-1"])'
          )
        ).filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const outside = !popoverRef.current.contains(active);
        if (e.shiftKey && (active === first || outside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || outside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const [todayY, todayM, todayD] = todayKl.split("-").map(Number);

  const clampActiveDayForMonth = (year: number, monthIdx: number, preferredDay: number) => {
    const maxInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const isCurrentKlMonth = year === todayY && monthIdx === todayM - 1;
    const upperBound = isCurrentKlMonth ? Math.min(maxInMonth, todayD || maxInMonth) : maxInMonth;
    return Math.max(1, Math.min(preferredDay, upperBound));
  };

  const prevMonth = () => {
    const nextY = viewMonth === 0 ? viewYear - 1 : viewYear;
    const nextM = viewMonth === 0 ? 11 : viewMonth - 1;
    setViewYear(nextY);
    setViewMonth(nextM);
    setActiveDay((prev) => clampActiveDayForMonth(nextY, nextM, prev));
  };

  const nextMonth = () => {
    if (viewYear > todayY || (viewYear === todayY && viewMonth >= todayM - 1)) {
      return;
    }
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    const clampedDay = clampActiveDayForMonth(nextY, nextM, activeDay);
    const reachedCurrentMonth = nextY > todayY || (nextY === todayY && nextM >= todayM - 1);
    setViewYear(nextY);
    setViewMonth(nextM);
    setActiveDay(clampedDay);
    // When Next Month becomes disabled upon reaching the current month, move focus to the active date instead of dropping to <body>
    if (reachedCurrentMonth) {
      requestAnimationFrame(() => {
        dayRefs.current[clampedDay - 1]?.focus();
      });
    }
  };

  const canGoNextMonth =
    viewYear < todayY || (viewYear === todayY && viewMonth < todayM - 1);

  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDaySundayBased = new Date(viewYear, viewMonth, 1).getDay();
  const startDayOffset = (firstDaySundayBased + 6) % 7;

  const weekHeadersZh = ["一", "二", "三", "四", "五", "六", "日"];
  const weekHeadersEn = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const weekHeaders = lang === "zh" ? weekHeadersZh : weekHeadersEn;

  const monthTitle =
    lang === "zh"
      ? `${viewYear}年 ${viewMonth + 1}月`
      : new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
          month: "short",
          year: "numeric",
        });

  const effectiveTabDay = clampActiveDayForMonth(viewYear, viewMonth, activeDay);

  const handleDayKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, dayIdx: number) => {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -1;
    else if (e.key === "ArrowRight") delta = 1;
    else if (e.key === "ArrowUp") delta = -7;
    else if (e.key === "ArrowDown") delta = 7;
    if (delta === 0) return;
    e.preventDefault();
    const nextIdx = dayIdx + delta;
    if (nextIdx >= 0 && nextIdx < totalDays) {
      const target = dayRefs.current[nextIdx];
      if (target && !target.disabled) {
        setActiveDay(nextIdx + 1);
        target.focus();
      }
    }
  };

  return (
    <div ref={dialogRootRef}>
      {/* Backdrop sits above mobile bottom nav (z-40) so outside taps only dismiss the calendar */}
      <div
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed inset-0 z-[45] bg-black/30 sm:bg-transparent touch-none"
      />

      {/* Static positioning wrapper: full-bottom native sheet on phones (<sm) and short landscape viewports (<=500px tall), right-flush floating popover on tall sm+ */}
      <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2.5 sm:right-0 sm:left-auto [@media(max-height:500px)]:fixed [@media(max-height:500px)]:inset-x-0 [@media(max-height:500px)]:bottom-0 [@media(max-height:500px)]:top-auto [@media(max-height:500px)]:mt-0 [@media(max-height:500px)]:w-full [@media(max-height:500px)]:max-w-none z-50 w-full sm:w-[396px] sm:max-w-[calc(100vw-2rem)]">
        <div
          ref={popoverRef}
          className="bg-surface border-t sm:border [@media(max-height:500px)]:border-x-0 [@media(max-height:500px)]:border-b-0 border-surface-border rounded-t-2xl rounded-b-none sm:rounded-2xl [@media(max-height:500px)]:rounded-b-none shadow-popover max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden px-1.5 pt-2.5 pb-[max(1.5rem,calc(1rem+env(safe-area-inset-bottom,0px)))] [@media(max-height:500px)]:pb-1.5 min-[375px]:px-3 sm:p-3.5 [@media(max-height:500px)]:py-2 select-none animate-slide-up sm:animate-slide-down [@media(max-height:500px)]:animate-slide-up"
          role="dialog"
          aria-modal="true"
          aria-label={t.datePickerLabel}
        >
          {/* Portrait mobile sheet header with explicit 48px Close control (merged into month row on short landscape <=500px tall) */}
          <div className="sm:hidden [@media(max-height:500px)]:hidden shrink-0 flex items-center justify-between pl-2.5 pr-1 pb-2 mb-1.5 border-b border-surface-border/70">
            <span className="text-sm font-bold text-ink-primary">
              {t.datePickerLabel}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.closeLabel}
              className="w-12 h-12 -my-1 rounded-xl hover:bg-surface-subtle text-ink-secondary hover:text-ink-primary flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Month & Year Navigation Header (grid keeps month title optically centered even with compact Close in short landscape) */}
          <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 mb-1.5">
            <button
              type="button"
              onClick={prevMonth}
              aria-label={t.prevMonthLabel}
              className="justify-self-start w-12 h-12 [@media(max-height:500px)]:w-11 [@media(max-height:500px)]:h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer shrink-0"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <span
              aria-live="polite"
              aria-atomic="true"
              className="text-sm font-bold text-ink-primary tracking-tight text-center"
            >
              {monthTitle}
            </span>

            <div className="justify-self-end flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!canGoNextMonth}
                onClick={nextMonth}
                aria-label={t.nextMonthLabel}
                className="w-12 h-12 [@media(max-height:500px)]:w-11 [@media(max-height:500px)]:h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary flex items-center justify-center transition-colors disabled:opacity-25 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.closeLabel}
                className="hidden [@media(max-height:500px)]:flex w-11 h-11 rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary hover:text-ink-primary items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Sticky Weekday Headers above Scrollable Day Grid */}
          <div className="shrink-0 grid grid-cols-7 gap-px min-[375px]:gap-1 text-center mb-1">
            {weekHeaders.map((w) => (
              <span
                key={w}
                className="text-xs font-semibold text-ink-muted h-7 [@media(max-height:500px)]:h-6 flex items-center justify-center"
              >
                {w}
              </span>
            ))}
          </div>

          {/* Scrollable Day Grid Wrapper with visible top & bottom overflow shadow cues */}
          <div className="relative min-h-0 flex-1 flex flex-col">
            {canScrollUp && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-surface/95 to-transparent shadow-[inset_0_8px_10px_-8px_rgba(22,22,20,0.22)] dark:shadow-[inset_0_8px_10px_-8px_rgba(0,0,0,0.55)]"
              />
            )}
            <div
              ref={gridScrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setCanScrollUp(el.scrollTop > 2);
                setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              {/* Calendar Grid — Single Tab stop via roving tabIndex + Arrow-key grid navigation */}
              <div className="grid grid-cols-7 gap-px min-[375px]:gap-1 text-center [@media(max-height:500px)]:pb-2">
              {Array.from({ length: startDayOffset }).map((_, i) => (
                <div key={`empty-${i}`} className="h-12 [@media(max-height:500px)]:h-11" />
              ))}

            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const dayStr = String(day).padStart(2, "0");
              const monthStr = String(viewMonth + 1).padStart(2, "0");
              const cellDate = `${viewYear}-${monthStr}-${dayStr}`;

              const isSelected = cellDate === date;
              const isToday = cellDate === todayKl;
              const isFuture = cellDate > todayKl;
              const isTabStop = !isFuture && day === effectiveTabDay;

              return (
                <button
                  key={cellDate}
                  ref={(el) => {
                    dayRefs.current[i] = el;
                  }}
                  type="button"
                  data-calendar-day={cellDate}
                  disabled={isFuture}
                  tabIndex={isTabStop ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onFocus={() => setActiveDay(day)}
                  onClick={() => {
                    const handoff = onSelectDate(cellDate);
                    if (handoff === false) {
                      skipFocusRestoreRef.current = true;
                    }
                    onClose();
                  }}
                  onKeyDown={(e) => handleDayKeyDown(e, i)}
                  aria-label={cellDate}
                  className={`h-12 [@media(max-height:500px)]:h-11 w-full rounded-xl text-sm font-medium num-tabular flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
                    isSelected
                      ? "bg-brand-cta text-brand-cta-ink font-bold shadow-card"
                      : isFuture
                        ? "text-ink-muted/30 cursor-not-allowed"
                        : isToday
                          ? "border border-brand-broccoli text-brand-broccoli font-bold hover:bg-brand-broccoli-light cursor-pointer"
                          : "text-ink-primary hover:bg-surface-subtle cursor-pointer"
                  }`}
                >
                  {day}
                </button>
              );
            })}
              </div>
            </div>
            {canScrollDown && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-surface/95 to-transparent shadow-[inset_0_-8px_10px_-8px_rgba(22,22,20,0.22)] dark:shadow-[inset_0_-8px_10px_-8px_rgba(0,0,0,0.55)] flex items-end justify-center pb-0.5"
              >
                <svg className="w-3.5 h-3.5 text-ink-muted/75" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
