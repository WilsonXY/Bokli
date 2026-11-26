"use client";

import React from "react";

export interface FormattedMyrParts {
  negative: boolean;
  sign: string;
  whole: string;
  cents: string;
  plain: string;
}

/**
 * Format integer sen into display parts with thousands grouping and a true
 * mathematical minus sign (U+2212). Keeps `formatMyr` in `src/lib/money.ts`
 * untouched for wire/test compatibility.
 */
export function formatDisplayMyrParts(sen: bigint | number): FormattedMyrParts {
  const value = typeof sen === "bigint" ? sen : BigInt(Math.round(sen));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const ringgit = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  const whole = ringgit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "\u2212" : "";
  return {
    negative,
    sign,
    whole,
    cents,
    plain: `${sign}RM ${whole}.${cents}`,
  };
}

export function formatDisplayMyr(sen: bigint | number): string {
  return formatDisplayMyrParts(sen).plain;
}

/**
 * Compact chart/axis formatter, e.g. RM 1,700 or RM 2.4k.
 */
export function formatCompactMyr(sen: bigint | number): string {
  const value = typeof sen === "bigint" ? Number(sen) : sen;
  const absRm = Math.abs(value) / 100;
  const sign = value < 0 ? "\u2212" : "";
  if (absRm >= 10000) {
    return `${sign}RM ${(absRm / 1000).toFixed(1)}k`;
  }
  const rounded = Math.round(absRm).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}RM ${rounded}`;
}

interface MoneyValueProps {
  sen: bigint | number;
  variant?: "hero" | "metric" | "inline";
  showPlus?: boolean;
  className?: string;
}

export function MoneyValue({
  sen,
  variant = "inline",
  showPlus = false,
  className = "",
}: MoneyValueProps) {
  const parts = formatDisplayMyrParts(sen);
  const value = typeof sen === "bigint" ? sen : BigInt(Math.round(sen));
  const prefixSign = parts.negative ? "\u2212" : showPlus && value > 0n ? "+" : "";

  if (variant === "hero") {
    return (
      <span className={`inline-flex items-baseline num-tabular whitespace-nowrap ${className}`}>
        <span className="text-[0.52em] font-semibold tracking-normal mr-1.5">
          {prefixSign ? `${prefixSign}RM` : "RM"}
        </span>
        <span>{parts.whole}</span>
        <span className="text-[0.66em] font-semibold">.{parts.cents}</span>
      </span>
    );
  }

  if (variant === "metric") {
    return (
      <span className={`inline-flex items-baseline num-tabular whitespace-nowrap ${className}`}>
        <span className="text-[0.68em] font-semibold mr-1">
          {prefixSign ? `${prefixSign}RM` : "RM"}
        </span>
        <span>{parts.whole}</span>
        <span className="text-[0.76em]">.{parts.cents}</span>
      </span>
    );
  }

  return (
    <span className={`num-tabular whitespace-nowrap ${className}`}>
      {prefixSign}RM {parts.whole}.{parts.cents}
    </span>
  );
}
