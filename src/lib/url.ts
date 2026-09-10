/**
 * Validates and sanitizes a callbackUrl redirect target.
 * Ensures the target is a relative same-origin path:
 * - Starts with "/"
 * - Does not start with "//" (protocol-relative URL bypass)
 * - Does not contain "\" (backslash bypass / normalizations)
 */
export function sanitizeCallbackUrl(url: string | null | undefined, fallback = "/"): string {
  if (
    url &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.includes("\\")
  ) {
    return url;
  }
  return fallback;
}
