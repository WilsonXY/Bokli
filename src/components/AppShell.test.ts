import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

const route = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));
afterEach(() => { route.pathname = "/dashboard"; route.search = ""; });

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { AppShell } from "./AppShell";
import { DICTIONARY } from "@/lib/i18n";

describe("AppShell bottom navigation order", () => {
  it("puts the primary Daily Sheet task before Overview", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        AppShell,
        { children: React.createElement("div", null, "Child Content") }
      )
    );

    // Verify both items are present
    expect(html).toContain(DICTIONARY.zh.navDashboard);
    expect(html).toContain(DICTIONARY.zh.navSheet);

    // Verify the Daily Sheet link precedes Overview.
    const navigation = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const dashIndex = navigation.indexOf("href=\"/dashboard\"");
    const sheetIndex = navigation.indexOf("href=\"/\"");

    expect(dashIndex).toBeGreaterThan(-1);
    expect(sheetIndex).toBeGreaterThan(-1);
    expect(sheetIndex).toBeLessThan(dashIndex);
  });
});


describe("workspace navigation", () => {
  it("keeps preferences on a settings route and marks the current page", () => {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(AppShell, { children: "Content" }));
    expect(html).toContain('href="/settings"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="#main-content"');
    expect(html).not.toContain('Switch to English');
    expect(html).not.toContain('Switch to Chinese');
  });
});


describe("navigation preserves the current bookkeeping period", () => {
  function hrefFor(label: string) {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(AppShell, { children: "Content" }));
    const anchor = html.match(/<a\b[^>]*>/g)?.find(tag => tag.includes(`aria-label="${label}"`));
    return anchor?.match(/href="([^"]*)"/)?.[1];
  }

  it("keeps the selected date in the active Sheet link", () => {
    route.pathname = "/";
    route.search = "date=2026-11-10";
    expect(hrefFor(DICTIONARY.zh.navSheet)).toBe("/?date=2026-11-10");
  });

  it("returns directly from Month Close to Overview for the same month", () => {
    route.pathname = "/close";
    route.search = "month=2026-10";
    expect(hrefFor(DICTIONARY.zh.navDashboard)).toBe("/dashboard?month=2026-10");
  });


});
