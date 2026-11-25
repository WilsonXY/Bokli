"use client";

import React, { useState, useRef, useEffect } from "react";
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
}

export function MonthSelectorDropdown({
  currentMonth,
  options,
  onSelect,
  ariaLabel,
  showStatusInTrigger = true,
  className = "",
  defaultOpen = false,
}: MonthSelectorDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const prevOpenRef = useRef(defaultOpen);
  const restoreFocusOnCloseRef = useRef(false);

  const currentOption = options.find((opt) => opt.month === currentMonth);
  const currentStatus = currentOption?.status ?? "open";

  const fullOptions = options.some((opt) => opt.month === currentMonth)
    ? options
    : [{ month: currentMonth, status: "open" as const }, ...options];

  const getInitialActiveIdx = () => {
    const selectedIdx = fullOptions.findIndex(
      (opt) => opt.month === currentMonth && !opt.disabled
    );
    if (selectedIdx >= 0) return selectedIdx;
    const firstEnabledIdx = fullOptions.findIndex((opt) => !opt.disabled);
    return firstEnabledIdx >= 0 ? firstEnabledIdx : 0;
  };

  const [activeIdx, setActiveIdx] = useState<number>(getInitialActiveIdx);

  useEffect(() => {
    if (!isOpen) {
      if (prevOpenRef.current) {
        prevOpenRef.current = false;
        if (restoreFocusOnCloseRef.current) {
          restoreFocusOnCloseRef.current = false;
          triggerBtnRef.current?.focus();
        }
      }
      return;
    }

    if (!prevOpenRef.current) {
      prevOpenRef.current = true;
      const focusIdx = getInitialActiveIdx();
      setActiveIdx(focusIdx);
      const raf = requestAnimationFrame(() => {
        if (focusIdx >= 0) {
          optionRefs.current[focusIdx]?.focus();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        restoreFocusOnCloseRef.current = false;
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        restoreFocusOnCloseRef.current = true;
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

  function getStatusBadgeStyle(status?: MonthStatus) {
    switch (status) {
      case "closed":
        return "bg-status-closed-bg text-status-closed border-status-closed/20";
      case "reopened":
        return "bg-status-reopened-bg text-status-reopened border-status-reopened/20";
      default:
        return "bg-status-open-bg text-status-open border-status-open/20";
    }
  }

  const effectiveActiveIdx =
    activeIdx >= 0 && activeIdx < fullOptions.length && !fullOptions[activeIdx]?.disabled
      ? activeIdx
      : getInitialActiveIdx();

  const moveFocus = (fromIdx: number, direction: 1 | -1) => {
    const len = fullOptions.length;
    for (let step = 1; step <= len; step++) {
      const next = (fromIdx + direction * step + len) % len;
      if (!fullOptions[next]?.disabled) {
        setActiveIdx(next);
        optionRefs.current[next]?.focus();
        return;
      }
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
    }
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(idx, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(idx, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = fullOptions.findIndex((opt) => !opt.disabled);
      if (first >= 0) {
        setActiveIdx(first);
        optionRefs.current[first]?.focus();
      }
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = fullOptions.length - 1; i >= 0; i--) {
        if (!fullOptions[i].disabled) {
          setActiveIdx(i);
          optionRefs.current[i]?.focus();
          break;
        }
      }
    }
  };

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isOpen && !containerRef.current?.contains(e.relatedTarget as Node | null)) {
      restoreFocusOnCloseRef.current = false;
      setIsOpen(false);
    }
  };

  const baseLabel = ariaLabel || t.monthSelect;
  const triggerAriaLabel = showStatusInTrigger
    ? `${baseLabel}: ${currentMonth} (${getStatusLabel(currentStatus)})`
    : `${baseLabel}: ${currentMonth}`;

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className={`relative inline-block text-left shrink-0 ${className}`}
    >
      {/* Dropdown Trigger Button */}
      <button
        ref={triggerBtnRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={triggerAriaLabel}
        className="min-h-[48px] h-12 sm:min-h-[44px] sm:h-11 px-2.5 sm:px-3 rounded-xl border border-surface-border bg-surface hover:border-surface-border-strong hover:bg-surface-subtle/50 btn-tactile flex items-center gap-1.5 sm:gap-2 shadow-card cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
      >
        <svg className="hidden min-[360px]:block w-4 h-4 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <span className="font-semibold text-sm text-ink-primary tracking-tight num-tabular whitespace-nowrap shrink-0">
          {currentMonth}
        </span>
        {showStatusInTrigger && (
          <span
            className={`grid text-center text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${getStatusBadgeStyle(
              currentStatus,
            )}`}
          >
            {(["open", "closed", "reopened"] as const).map((status) => (
              <span key={status} className={`col-start-1 row-start-1 whitespace-nowrap${status === currentStatus ? "" : " invisible"}`}>
                {getStatusLabel(status)}
              </span>
            ))}
          </span>
        )}
        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-ink-muted transition-transform duration-150 shrink-0 ${
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

      {/* Dropdown Menu — Single Tab stop via roving tabIndex + Arrow/Home/End navigation */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={baseLabel}
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-50 w-60 max-h-72 overflow-y-auto bg-surface border border-surface-border rounded-2xl shadow-popover p-1.5 space-y-1 animate-dropdown focus:outline-none"
        >
          {fullOptions.map((opt, idx) => {
            const isSelected = opt.month === currentMonth;
            const status = opt.status ?? "open";
            const isTabStop = !opt.disabled && idx === effectiveActiveIdx;
            return (
              <button
                key={opt.month}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                role="option"
                aria-selected={isSelected}
                type="button"
                disabled={opt.disabled}
                tabIndex={isTabStop ? 0 : -1}
                onFocus={() => setActiveIdx(idx)}
                onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                onClick={() => {
                  if (opt.disabled) return;
                  restoreFocusOnCloseRef.current = true;
                  setIsOpen(false);
                  if (opt.month !== currentMonth) {
                    onSelect(opt.month);
                  }
                }}
                className={`w-full min-h-[48px] sm:min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
                  opt.disabled
                    ? "opacity-40 cursor-not-allowed text-ink-muted"
                    : "cursor-pointer " +
                      (isSelected
                        ? "bg-brand-broccoli-light font-semibold text-brand-broccoli"
                        : "text-ink-primary hover:bg-surface-subtle font-medium")
                }`}
              >
                <span className="truncate num-tabular">{opt.month}</span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${getStatusBadgeStyle(
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
