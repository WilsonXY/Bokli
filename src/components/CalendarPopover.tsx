"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ActionIcon } from "./ActionIcon";
import { cloudRead } from "@/lib/cloud-client";

interface CalendarPopoverProps {
  date: string; // YYYY-MM-DD
  todayKl: string; // YYYY-MM-DD
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
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
  const popoverRef = useRef<HTMLDivElement>(null);

  // Parse initial year/month from date
  const [initialYear, initialMonth] = date.split("-").map(Number);
  const [viewYear, setViewYear] = useState<number>(initialYear || 2026);
  const [viewMonth, setViewMonth] = useState<number>(
    initialMonth !== undefined ? initialMonth - 1 : 8,
  );

  const viewPeriod = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const [retrySequence, setRetrySequence] = useState(0);
  const [recorded, setRecorded] = useState<{ month: string; dates: string[]; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setRecorded(null);
    cloudRead("dashboard", `?month=${viewPeriod}`).then(
      page => { if (active) setRecorded({ month: viewPeriod, dates: page.trend.map(row => row.date) }); },
      () => { if (active) setRecorded({ month: viewPeriod, dates: [], failed: true }); },
    );
    return () => { active = false; };
  }, [isOpen, viewPeriod, retrySequence]);

  // Sync viewing month when date changes or popover opens
  useEffect(() => {
    if (isOpen) {
      const [y, m] = date.split("-").map(Number);
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  }, [isOpen, date]);

  useEffect(() => {
    if (!isOpen) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const trigger = triggerRef?.current;
    return () => trigger?.focus({ preventScroll: true });
  }, [isOpen, triggerRef]);

  // Click outside & Escape key detection
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: Event) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        (!triggerRef?.current || !triggerRef.current.contains(target))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("focusin", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("focusin", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  // Month navigation
  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    // Prevent navigating past the current month in KL
    const [todayY, todayM] = todayKl.split("-").map(Number);
    if (viewYear > todayY || (viewYear === todayY && viewMonth >= todayM - 1)) {
      return;
    }
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const [todayY, todayM] = todayKl.split("-").map(Number);
  const canGoNextMonth =
    viewYear < todayY || (viewYear === todayY && viewMonth < todayM - 1);

  // Days in month calculation
  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDaySundayBased = new Date(viewYear, viewMonth, 1).getDay();
  // Monday based offset: 0=Monday, 6=Sunday
  const startDayOffset = (firstDaySundayBased + 6) % 7;

  const weekHeadersZh = ["一", "二", "三", "四", "五", "六", "日"];
  const weekHeadersEn = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const weekHeaders = lang === "zh" ? weekHeadersZh : weekHeadersEn;

  const monthTitle = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;

  return (
    <>
    <div className="calendar-backdrop" aria-hidden="true" />
    <div
      ref={popoverRef}
      className="calendar-popover absolute top-full mt-2 left-1/2 z-50 bg-white border border-surface-border rounded-2xl shadow-xl p-3.5 w-72 max-w-[calc(100vw-2rem)] select-none animate-popover"
      role="dialog"
      aria-modal="false"
      aria-label={t.calendarTitle}
    >
      {/* Month & Year Navigation Header */}
      <div className="calendar-header mb-2.5 px-0.5">
        <button
          type="button"
          onClick={prevMonth}
          aria-label={t.prevMonth}
          className="w-11 h-11 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary flex items-center justify-center text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="calendar-month-label text-sm font-bold text-ink-primary">
          {monthTitle}
        </span>

        <button
          type="button"
          disabled={!canGoNextMonth}
          onClick={nextMonth}
          aria-label={t.nextMonth}
          className="w-11 h-11 rounded-lg border border-surface-border hover:bg-surface-subtle btn-wave text-ink-secondary flex items-center justify-center text-sm font-semibold transition-colors disabled:opacity-20 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button type="button" className="calendar-close" aria-label={t.closeCalendar} title={t.closeCalendar} onClick={onClose}><ActionIcon name="close" /></button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {weekHeaders.map((w) => (
          <span
            key={w}
            className="calendar-weekday text-[13px] font-semibold text-ink-muted h-5 flex items-center justify-center"
          >
            {w}
          </span>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {/* Empty slots before month start */}
        {Array.from({ length: startDayOffset }).map((_, i) => (
          <div key={`empty-${i}`} className="h-11" />
        ))}

        {/* Month Day Cells */}
        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1;
          const dayStr = String(day).padStart(2, "0");
          const monthStr = String(viewMonth + 1).padStart(2, "0");
          const cellDate = `${viewYear}-${monthStr}-${dayStr}`;

          const isSelected = cellDate === date;
          const isToday = cellDate === todayKl;
          const isFuture = cellDate > todayKl;
          const isRecorded = recorded?.month === viewPeriod && recorded.dates.includes(cellDate);

          return (
            <button
              key={cellDate}
              type="button"
              disabled={isFuture}
              onClick={() => {
                onSelectDate(cellDate);
                onClose();
              }}
              aria-label={cellDate}
              aria-describedby={isRecorded ? "calendar-recorded-legend" : undefined}
              data-recorded={isRecorded || undefined}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={`calendar-day relative h-11 w-full mx-auto rounded-lg btn-wave text-sm font-medium flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 ${
                isSelected
                  ? "bg-brand-broccoli text-white font-bold shadow-xs scale-105"
                  : isFuture
                    ? "text-ink-muted/30 cursor-not-allowed"
                    : isToday
                      ? "border border-brand-broccoli text-brand-broccoli font-bold hover:bg-brand-broccoli-light"
                      : "text-ink-primary hover:bg-surface-subtle"
              }`}
            >
              {day}
              {isRecorded && <span className="calendar-recorded-mark" aria-hidden="true"><ActionIcon name="check" size={16} /></span>}
            </button>
          );
        })}
      </div>
      <span id="calendar-recorded-legend" className="sr-only">{t.recordedSheet}</span>
      {recorded?.month !== viewPeriod ? <div className="calendar-activity" data-state="loading" role="status"><span className="animate-spin"><ActionIcon name="loading" /></span><span className="sr-only">{t.recordedDaysLoading}</span></div> : recorded.failed ? <div className="calendar-activity" data-state="failed" role="status"><ActionIcon name="warning" /><span>{t.recordedDaysFailed}</span><button type="button" className="calendar-retry" aria-label={t.retry} title={t.retry} onClick={() => setRetrySequence(value => value + 1)}><ActionIcon name="refresh" /></button></div> : recorded.dates.length === 0 ? <span className="sr-only" data-state="empty" role="status">{t.noRecordedDays}</span> : null}
    </div>
    </>
  );
}
