/**
 * Money value object — MYR only, integer sen.
 *
 * ADR-0004: amounts are stored and computed as 64-bit integer sen.
 * No floats ever touch arithmetic; decimal strings are parsed into
 * integer sen and formatting back to strings happens only at display.
 */

const MAX_SEN = 9007199254740991n; // 2^53 - 1, safe integer headroom

export class MoneyFormatError extends Error {
  constructor(input: string) {
    super(`Invalid MYR amount: "${input}"`);
    this.name = "MoneyFormatError";
  }
}

export class MoneyRangeError extends Error {
  constructor(sen: bigint) {
    super(`Amount out of range: ${sen} sen`);
    this.name = "MoneyRangeError";
  }
}

/** Assert a signed sen amount is within representable range. */
function assertRange(sen: bigint): bigint {
  if (sen > MAX_SEN || sen < -MAX_SEN) throw new MoneyRangeError(sen);
  return sen;
}

/**
 * Parse a decimal MYR string into sen.
 * Accepts "12.34", "12", "12.3", "-1.50", "0.05". Rejects anything
 * with more than 2 decimal places, empty strings, or non-numeric text.
 */
export function parseSen(input: string): bigint {
  const s = input.trim();
  if (s.length === 0) throw new MoneyFormatError(input);

  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new MoneyFormatError(input);

  const sign = m[1] === "-" ? -1n : 1n;
  const ringgit = BigInt(m[2]);
  const cents = m[3] ?? "";
  const sen = cents.padEnd(2, "0");

  return assertRange(sign * (ringgit * 100n + BigInt(sen)));
}

/** Format integer sen as a MYR display string, e.g. 1234n -> "RM12.34". */
export function formatMyr(sen: bigint): string {
  assertRange(sen);
  const sign = sen < 0n ? "-" : "";
  const abs = sen < 0n ? -sen : sen;
  const ringgit = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${sign}RM${ringgit}.${cents}`;
}

/** Sum a list of sen amounts with range checking. */
export function sumSen(amounts: readonly bigint[]): bigint {
  let total = 0n;
  for (const a of amounts) total += a;
  return assertRange(total);
}

/** a - b with range checking. */
export function subSen(a: bigint, b: bigint): bigint {
  return assertRange(a - b);
}

/**
 * Validate and sanitize money input string while typing or pasting.
 * Cleans whitespace, commas, and optional leading 'RM'. Normalizes '.5' to '0.5'.
 * Returns the cleaned valid string, or null if the input contains invalid format
 * (such as letters, negative signs, bare '.', trailing '12.', or more than 2 decimal places).
 */
export function sanitizeMoneyInput(raw: string): string | null {
  let cleaned = raw.trim().replace(/^RM\s*/i, "").replace(/,/g, "").trim();
  if (cleaned === "") return "";
  if (/^\.\d{1,2}$/.test(cleaned)) {
    cleaned = `0${cleaned}`;
  }
  if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Parse an Asia/Kuala_Lumpur calendar date string "YYYY-MM-DD".
 * Stored as plain strings per spec — no Date objects, no timezone math.
 */
export function isValidDateStr(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Validate an Asia/Kuala_Lumpur calendar month string "YYYY-MM".
 */
export function isValidMonthStr(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}
