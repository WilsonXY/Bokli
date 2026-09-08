"use client";

import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface CalendarPopoverProps {
  date: string; // YYYY-MM-DD
  todayKl: string; // YYYY-MM-DD
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
}

export function CalendarPopover({
  date,
  todayKl,
  isOpen,
  onClose,
  onSelectDate,
}: CalendarPopoverProps) {
  const { lang } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Parse initial year/month from date
  const [initialYear, initialMonth] = date.split("-").map(Number);
  const [viewYear, setViewYear] = useState<number>(initialYear || 2026);
  const [viewMonth, setViewMonth] = useState<number>(
    initialMonth !== undefined ? initialMonth - 1 : 8,
  );

  // Sync viewing month when date changes
  useEffect(() => {
    const [y, m] = date.split("-").map(Number);
    if (y && m) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
  }, [date]);

  // Click outside & Escape key detection
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
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
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

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

  const monthTitle =
    lang === "zh"
      ? `${viewYear}年 ${viewMonth + 1}月`
      : new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
          month: "short",
          year: "numeric",
        });

  return (
    <div
      ref={popoverRef}
      className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 bg-white border border-surface-border rounded-xl shadow-lg p-3 w-64 select-none animate-in fade-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      aria-label="Date Picker"
    >
      {/* Month & Year Navigation Header */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <button
          type="button"
          onClick={prevMonth}
          className="w-7 h-7 rounded-lg border border-surface-border hover:bg-surface-subtle text-ink-secondary flex items-center justify-center text-xs transition-colors"
          title="Previous Month"
        >
          ←
        </button>

        <span className="text-xs font-bold text-ink-primary">
          {monthTitle}
        </span>

        <button
          type="button"
          disabled={!canGoNextMonth}
          onClick={nextMonth}
          className="w-7 h-7 rounded-lg border border-surface-border hover:bg-surface-subtle text-ink-secondary flex items-center justify-center text-xs transition-colors disabled:opacity-20 disabled:pointer-events-none"
          title="Next Month"
        >
          →
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {weekHeaders.map((w) => (
          <span
            key={w}
            className="text-[10px] font-semibold text-ink-muted h-5 flex items-center justify-center"
          >
            {w}
          </span>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {/* Empty slots before month start */}
        {Array.from({ length: startDayOffset }).map((_, i) => (
          <div key={`empty-${i}`} className="h-7" />
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

          return (
            <button
              key={cellDate}
              type="button"
              disabled={isFuture}
              onClick={() => {
                onSelectDate(cellDate);
                onClose();
              }}
              className={`h-7 w-7 mx-auto rounded-lg text-xs font-medium flex items-center justify-center transition-all ${
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
