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

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
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
