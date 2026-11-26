/**
 * Behaviour for programmatic scrolls: smooth, unless the person asked their
 * device for reduced motion (CSS cannot override a script's "smooth").
 */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
