import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./motion";

describe("scrollBehavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is smooth by default and with no window", () => {
    expect(scrollBehavior()).toBe("smooth");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is instant when reduced motion is requested", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }),
    });
    expect(scrollBehavior()).toBe("auto");
  });
});
