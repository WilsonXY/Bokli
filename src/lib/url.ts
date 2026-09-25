/**
 * Validates and sanitizes a callbackUrl redirect target.
 * Ensures the target is a relative same-origin path:
 * - Starts with "/"
 * - Does not start with "//" (protocol-relative URL bypass)
 * - Does not contain "\" (backslash bypass / normalizations)
 * - Contains no C0 control characters or DEL (the WHATWG URL parser strips
 *   tab/LF/CR before parsing — "/\t//evil.example" would otherwise pass the
 *   checks above and then resolve off-origin; the other C0/DEL bytes are
 *   rejected as defense-in-depth, they are not valid in paths anyway)
 */
export function sanitizeCallbackUrl(url: string | null | undefined, fallback = "/"): string {
  if (
    url &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(url)
  ) {
    return url;
  }
  return fallback;
}
