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

/**
 * Resolves where to send a user once they are logged in.
 * A missing callbackUrl, the bare root, or the login page itself all mean
 * "no meaningful target" and fall back; every other value goes through
 * sanitizeCallbackUrl so off-origin targets cannot leak through.
 *
 * Shared by the middleware and the login page so the policy lives in one
 * place; this module has no DB imports, keeping it middleware-safe.
 */
export function postLoginTarget(
  callbackUrl: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!callbackUrl || callbackUrl === "/" || callbackUrl.startsWith("/login")) {
    return fallback;
  }
  return sanitizeCallbackUrl(callbackUrl, fallback);
}
