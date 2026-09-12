/**
 * Resolves login error message using exact match checks.
 * Prevents URL parameter spoofing (e.g. substrings containing RateLimited).
 */
export function resolveLoginErrorMessage(
  code: string | null | undefined,
  error: string | null | undefined,
  t: { loginRateLimited: string; loginError: string },
): string | null {
  if (code === "RateLimited" || error === "RateLimited") {
    return t.loginRateLimited;
  }
  if (error) {
    return t.loginError;
  }
  return null;
}
