/**
 * Shared prose for the server pages' `loadError` banner.
 *
 * Each page catches its own read failures, logs them under its own scope tag,
 * and passes the string from here into its view's `loadError` prop. `scope`
 * names the data that failed, so the wording stays per-page instead of
 * collapsing into one generic sentence.
 */
export type LoadErrorScope = "expenses" | "month close" | "month";

export function describeLoadError(scope: LoadErrorScope): string {
  return `Failed to load ${scope} data. Please refresh or try again later.`;
}
