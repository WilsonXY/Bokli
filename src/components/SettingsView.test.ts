import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { SettingsView } from "./SettingsView";
import { DICTIONARY } from "@/lib/i18n";

describe("SettingsView", () => {
  it("renders Bright Mode selected by default alongside Dark Mode and Language native radios", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SettingsView, { initialRole: "Operator" })
    );

    // Bright mode native radio is checked by default, Dark mode is unchecked (localized visible labels)
    const lightInput = html.match(/<input[^>]*name="bokli-theme"[^>]*value="light"[^>]*>/)?.[0];
    const darkInput = html.match(/<input[^>]*name="bokli-theme"[^>]*value="dark"[^>]*>/)?.[0];
    expect(lightInput).toBeDefined();
    expect(lightInput).toContain('type="radio"');
    expect(lightInput).toContain('checked=""');
    expect(lightInput).not.toContain('aria-label="Switch to Bright Mode"');
    expect(darkInput).toBeDefined();
    expect(darkInput).toContain('type="radio"');
    expect(darkInput).not.toContain('checked=""');
    expect(darkInput).not.toContain('aria-label="Switch to Dark Mode"');
    expect(html).toContain(DICTIONARY.zh.themeLight);
    expect(html).toContain(DICTIONARY.zh.themeDark);

    // Language native radios present with accessible labels
    expect(html).toContain('aria-label="切换到中文 (Switch to Chinese)"');
    expect(html).toContain('aria-label="Switch to English"');

    // Chinese labels present by default
    expect(html).toContain(DICTIONARY.zh.appearanceTitle);
    expect(html).toContain(DICTIONARY.zh.languageTitle);
    expect(html).toContain(DICTIONARY.zh.roleOperator);
    expect(html).toContain(DICTIONARY.zh.signOut);
  });

  it("renders Admin badge when signed in as Admin", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SettingsView, { initialRole: "Admin" })
    );
    expect(html).toContain(DICTIONARY.zh.roleAdmin);
  });
});
