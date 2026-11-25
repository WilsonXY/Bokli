"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface CalendarPopoverProps {
  date: string; // YYYY-MM-DD
  todayKl: string; // YYYY-MM-DD
  isOpen: boolean;
  onClose: () => void;
  /** Return `false` if the parent opened another modal (e.g. unsaved guard) so focus is not pulled back to the trigger. */
  onSelectDate: (date: string) => boolean | void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function CalendarPopover({
  date,
  todayKl,
  isOpen,
  onClose,
  onSelectDate,
  triggerRef,
}: CalendarPopoverProps) {
  const { lang, t } = useI18n();
  const dialogRootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const skipFocusRestoreRef = useRef(false);

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

  // Make background inert while modal dialog is open, move focus in, and restore inert + trigger focus on close
  useEffect(() => {
    if (!isOpen) return;

    const inerted: HTMLElement[] = [];
    const root = dialogRootRef.current;
    const returnTrigger = triggerRef?.current ?? null;
    if (root) {
      for (let node: HTMLElement | null = root; node && node !== document.body; node = node.parentElement) {
        for (const sibling of Array.from(node.parentElement?.children ?? [])) {
          if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
            sibling.inert = true;
            inerted.push(sibling);
          }
        }
      }
    }

    const raf = requestAnimationFrame(() => {
      const selectedBtn = popoverRef.current?.querySelector<HTMLButtonElement>(
        `button[aria-label="${date}"]:not(:disabled)`
      );
      const firstEnabled = popoverRef.current?.querySelector<HTMLButtonElement>(
        "button:not(:disabled)"
      );
      (selectedBtn ?? firstEnabled)?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      for (const el of inerted) el.inert = false;
      if (!skipFocusRestoreRef.current) {
        returnTrigger?.focus();
      }
      skipFocusRestoreRef.current = false;
    };
  }, [isOpen, date, triggerRef]);

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
        );
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
    setViewYear(nextY);
    setViewMonth(nextM);
    setActiveDay((prev) => clampActiveDayForMonth(nextY, nextM, prev));
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
        className="fixed inset-0 z-[45] bg-black/30 sm:bg-transparent"
      />

      {/* Static positioning wrapper (never shares element with transform animation; >=48px day cells at >=360px, max width at 320px) */}
      <div className="fixed inset-x-0.5 min-[375px]:inset-x-1 bottom-[calc(var(--mobile-nav-height)+0.5rem)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2.5 sm:right-0 sm:left-auto z-50 w-auto sm:w-[396px] max-w-[396px] sm:max-w-[calc(100vw-2rem)] mx-auto">
        <div
          ref={popoverRef}
          className="bg-surface border border-surface-border rounded-2xl shadow-popover px-1 py-2.5 min-[375px]:px-1.5 min-[375px]:py-3 sm:p-3.5 select-none animate-slide-down"
          role="dialog"
          aria-modal="true"
          aria-label={t.datePickerLabel}
        >
          {/* Month & Year Navigation Header */}
          <div className="flex items-center justify-between px-1 mb-2">
            <button
              type="button"
              onClick={prevMonth}
              aria-label={t.prevMonthLabel}
              className="w-12 h-12 rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <span className="text-sm font-bold text-ink-primary tracking-tight">
              {monthTitle}
            </span>

            <button
              type="button"
              disabled={!canGoNextMonth}
              onClick={nextMonth}
              aria-label={t.nextMonthLabel}
              className="w-12 h-12 rounded-xl border border-surface-border hover:bg-surface-subtle btn-tactile text-ink-secondary flex items-center justify-center transition-colors disabled:opacity-25 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-px min-[375px]:gap-0.5 sm:gap-1 text-center mb-1">
            {weekHeaders.map((w) => (
              <span
                key={w}
                className="text-xs font-semibold text-ink-muted h-7 flex items-center justify-center"
              >
                {w}
              </span>
            ))}
          </div>

          {/* Calendar Grid — Single Tab stop via roving tabIndex + Arrow-key grid navigation */}
          <div className="grid grid-cols-7 gap-px min-[375px]:gap-0.5 sm:gap-1 text-center">
            {Array.from({ length: startDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="h-12" />
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
                  disabled={isFuture}
                  tabIndex={isTabStop ? 0 : -1}
                  aria-pressed={isSelected}
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
                  className={`h-12 w-full rounded-xl text-sm font-medium num-tabular flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
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
      </div>
    </div>
  );
}
