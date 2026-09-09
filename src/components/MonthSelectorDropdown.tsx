"use client";

import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export interface MonthOption {
  month: string;
  status?: "open" | "closed" | "reopened";
}

interface MonthSelectorDropdownProps {
  currentMonth: string;
  options: MonthOption[];
  onSelect: (month: string) => void;
  ariaLabel?: string;
  showStatusInTrigger?: boolean;
  className?: string;
}

export function MonthSelectorDropdown({
  currentMonth,
  options,
  onSelect,
  ariaLabel,
  showStatusInTrigger = true,
  className = "",
}: MonthSelectorDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  function getStatusLabel(status?: "open" | "closed" | "reopened") {
    switch (status) {
      case "closed":
        return t.closedStatus;
      case "reopened":
        return t.reopenedStatus;
      default:
        return t.openStatus;
    }
  }

  function getStatusBadgeStyle(status?: "open" | "closed" | "reopened") {
    switch (status) {
      case "closed":
        return "bg-status-closed-bg text-status-closed border-status-closed/20";
      case "reopened":
        return "bg-status-reopened-bg text-status-reopened border-status-reopened/20";
      default:
        return "bg-status-open-bg text-status-open border-status-open/20";
    }
  }

  // Ensure currentMonth is present in options list
  const fullOptions = options.some((opt) => opt.month === currentMonth)
    ? options
    : [{ month: currentMonth, status: "open" as const }, ...options];

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* Dropdown Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || t.monthSelect}
        className="h-10 pl-3 pr-2.5 rounded-xl border border-surface-border bg-white hover:bg-surface-subtle active:scale-[0.98] transition-all flex items-center gap-2 shadow-xs cursor-pointer btn-wave focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
      >
        <span className="font-bold text-sm text-ink-primary tracking-tight">
          {currentMonth}
        </span>
        {showStatusInTrigger && (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${getStatusBadgeStyle(
              currentStatus,
            )}`}
          >
            {getStatusLabel(currentStatus)}
          </span>
        )}
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
      {isOpen && (
        <div
          role="listbox"
          aria-label={ariaLabel || t.monthSelect}
          className="absolute right-0 top-full mt-1.5 z-50 w-56 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-xl shadow-lg p-1.5 space-y-1 animate-dropdown focus:outline-none"
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
                onClick={() => {
                  setIsOpen(false);
                  if (opt.month !== currentMonth) {
                    onSelect(opt.month);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-left cursor-pointer ${
                  isSelected
                    ? "bg-brand-broccoli-light/70 font-bold text-brand-broccoli"
                    : "text-ink-primary hover:bg-surface-subtle font-medium"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isSelected ? (
                    <svg
                      aria-hidden="true"
                      className="w-4 h-4 text-brand-broccoli shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="truncate">{opt.month}</span>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${getStatusBadgeStyle(
                    status,
                  )}`}
                >
                  {getStatusLabel(status)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
