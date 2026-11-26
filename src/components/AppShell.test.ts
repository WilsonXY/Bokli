import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { AppShell } from "./AppShell";
import { DICTIONARY } from "@/lib/i18n";

describe("AppShell bottom navigation order", () => {
  it("renders Overview (navDashboard) first and Daily Sheet (navSheet) second", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        AppShell,
        { userRole: "operator", children: React.createElement("div", null, "Child Content") }
      )
    );

    // Verify both items are present
    expect(html).toContain(DICTIONARY.zh.navDashboard);
    expect(html).toContain(DICTIONARY.zh.navSheet);

    // Verify /dashboard link appears before / link in the bottom navigation
    const dashIndex = html.indexOf("href=\"/dashboard\"");
    const sheetIndex = html.indexOf("href=\"/\"");

    expect(dashIndex).toBeGreaterThan(-1);
    expect(sheetIndex).toBeGreaterThan(-1);
    expect(dashIndex).toBeLessThan(sheetIndex);
  });
});

import { skipToMainContent } from "./AppShell";

describe("skip link", () => {
  it("moves focus to the main content without adding a history entry", () => {
    const calls: string[] = [];
    const main = { focus: () => calls.push("focus") };
    const event = { preventDefault: () => calls.push("preventDefault") };
    skipToMainContent(event, { getElementById: (id: string) => (id === "main-content" ? main : null) });
    // preventDefault stops the "#main-content" hash push that the unsaved-changes
    // guard cannot index (a later multi-step Back would undo one entry short).
    expect(calls).toEqual(["preventDefault", "focus"]);
  });
});
