"use client";

import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { ActionIcon } from "./ActionIcon";
import { useI18n } from "@/lib/i18n";
import type { MonthStatus } from "@/services/dashboard";

export interface MonthOption {
  month: string;
  status?: MonthStatus;
  disabled?: boolean;
}

interface MonthSelectorDropdownProps {
  currentMonth: string;
  options: MonthOption[];
  onSelect: (month: string) => void;
  ariaLabel?: string;
  showStatusInTrigger?: boolean;
  className?: string;
  defaultOpen?: boolean;
  loadingLabel?: string;
}

export function MonthSelectorDropdown({
  currentMonth,
  options,
  onSelect,
  ariaLabel,
  showStatusInTrigger = true,
  className = "",
  defaultOpen = false,
  loadingLabel,
}: MonthSelectorDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({});
  const positionMenu = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(224, window.innerWidth - 32);
    const maxHeight = Math.max(48, Math.min(256, window.innerHeight - 32));
    const top = rect.bottom + maxHeight + 6 > window.innerHeight - 16 ? Math.max(16, rect.top - maxHeight - 6) : rect.bottom + 6;
    setMenuPosition({ position: "fixed", left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), top, width, maxHeight });
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); };
  }, [isOpen, positionMenu]);

  // Click outside and Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const currentOption = options.find((opt) => opt.month === currentMonth);
  const currentStatus = currentOption?.status ?? "open";

  function getStatusLabel(status?: MonthStatus) {
    switch (status) {
      case "closed":
        return t.closedStatus;
      case "reopened":
        return t.reopenedStatus;
      default:
        return t.openStatus;
    }
  }

  // Ensure currentMonth is present in options list
  const fullOptions = options.some((opt) => opt.month === currentMonth)
    ? options
    : [{ month: currentMonth, status: "open" as const }, ...options];

  return (
    <div ref={containerRef} className={`month-picker relative inline-block text-left ${className}`}>
      {/* Dropdown Trigger Button */}
      <button
        type="button"
        disabled={Boolean(loadingLabel)}
        data-loading={loadingLabel ? true : undefined}
        onClick={() => { positionMenu(); setIsOpen((prev) => !prev); }}
        aria-describedby={descriptionId}
        title={`${currentMonth} ${loadingLabel || getStatusLabel(currentStatus)}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-busy={loadingLabel ? true : undefined}
        aria-label={loadingLabel ? `${ariaLabel || t.monthSelect}${t.fieldColon}${currentMonth} ${loadingLabel}` : ariaLabel || t.monthSelect}
        className="month-picker-trigger h-11 pl-3 pr-2.5 rounded-xl border border-surface-border bg-white hover:bg-surface-subtle active:scale-[0.98] transition-all flex items-center gap-2 shadow-xs cursor-pointer btn-wave focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
      >
        <span data-unknown={!currentMonth || undefined} className="month-picker-date font-bold text-sm text-ink-primary tracking-tight">
          {currentMonth || "0000-00"}
        </span>
        <span id={descriptionId} className="sr-only">{currentMonth} {loadingLabel || getStatusLabel(currentStatus)}</span>
        {showStatusInTrigger && <span className={`month-status-symbol${loadingLabel ? " animate-spin" : ""}`} aria-hidden="true"><ActionIcon name={loadingLabel ? "refresh" : currentStatus === "closed" ? "lock" : "unlock"} size={18} /></span>}
        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-ink-muted transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-brand-broccoli" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Styled Dropdown Menu */}
      {isOpen && !loadingLabel && (
        <div
          role="listbox"
          style={menuPosition}
          aria-label={ariaLabel || t.monthSelect}
          className="month-options absolute right-0 top-full mt-1.5 z-50 w-56 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-xl shadow-lg p-1.5 space-y-1 animate-dropdown focus:outline-none"
        >
          {fullOptions.map((opt) => {
            const isSelected = opt.month === currentMonth;
            const status = opt.status ?? "open";
            return (
              <button
                key={opt.month}
                role="option"
                aria-selected={isSelected}
                type="button"
                disabled={opt.disabled}
                onClick={() => {
                  if (opt.disabled) return;
                  setIsOpen(false);
                  if (opt.month !== currentMonth) {
                    onSelect(opt.month);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-left ${
                  opt.disabled
                    ? "opacity-40 cursor-not-allowed text-ink-muted"
                    : "cursor-pointer " +
                      (isSelected
                        ? "bg-brand-broccoli-light/70 font-bold text-brand-broccoli"
                        : "text-ink-primary hover:bg-surface-subtle font-medium")
                }`}
              >
                <span className="truncate">{opt.month}</span>
                <span className="month-status-symbol" title={getStatusLabel(status)}><ActionIcon name={status === "closed" ? "lock" : "unlock"} size={18} /><span className="sr-only">{getStatusLabel(status)}</span></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
