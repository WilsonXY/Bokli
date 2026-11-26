const KL_TIME_ZONE = "Asia/Kuala_Lumpur";

const klDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const klDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Format an ISO string to "YYYY-MM-DD HH:mm:ss" in Asia/Kuala_Lumpur time.
 * If unparseable, returns the input unchanged defensively.
 */
export function formatKlDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const parts = klDateTimeFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

/**
 * Format an ISO string to "YYYY-MM-DD" in Asia/Kuala_Lumpur time.
 * If unparseable, returns the input unchanged defensively.
 */
export function formatKlDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const parts = klDateFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Returns today's date in Asia/Kuala_Lumpur wall time as "YYYY-MM-DD".
 */
export function getTodayInKualaLumpur(now: Date = new Date()): string {
  const parts = klDateFormatter.formatToParts(now);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Check whether a date string is in the future in Asia/Kuala_Lumpur.
 */
export function isFutureDateInKL(date: string, now: Date = new Date()): boolean {
  const today = getTodayInKualaLumpur(now);
  return date > today;
}

/** Short weekday for a YYYY-MM-DD date: 周一 / Mon. "" for a malformed date. */
export function formatWeekday(dateStr: string, lang: "zh" | "en"): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const zhDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const enDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return lang === "zh" ? zhDays[dt.getUTCDay()] : enDays[dt.getUTCDay()];
}
