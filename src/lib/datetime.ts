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
