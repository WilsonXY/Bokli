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

    // Bright mode native radio is checked by default, Dark mode is unchecked (title-only aria-labelledby + desc aria-describedby)
    const lightInput = html.match(/<input[^>]*name="bokli-theme"[^>]*value="light"[^>]*>/)?.[0];
    const darkInput = html.match(/<input[^>]*name="bokli-theme"[^>]*value="dark"[^>]*>/)?.[0];
    expect(lightInput).toBeDefined();
    expect(lightInput).toContain('type="radio"');
    expect(lightInput).toContain('checked=""');
    expect(lightInput).toContain('aria-labelledby="settings-theme-title-light"');
    expect(lightInput).toContain('aria-describedby="settings-theme-desc-light"');
    expect(lightInput).not.toContain('aria-label=');
    expect(darkInput).toBeDefined();
    expect(darkInput).toContain('type="radio"');
    expect(darkInput).not.toContain('checked=""');
    expect(darkInput).toContain('aria-labelledby="settings-theme-title-dark"');
    expect(darkInput).toContain('aria-describedby="settings-theme-desc-dark"');
    expect(darkInput).not.toContain('aria-label=');
    expect(html).toContain(DICTIONARY.zh.themeLight);
    expect(html).toContain(DICTIONARY.zh.themeDark);

    // Language native radios use visible title via aria-labelledby + description via aria-describedby (excluding decorative badge)
    const zhInput = html.match(/<input[^>]*name="bokli-language"[^>]*value="zh"[^>]*>/)?.[0];
    const enInput = html.match(/<input[^>]*name="bokli-language"[^>]*value="en"[^>]*>/)?.[0];
    expect(zhInput).toBeDefined();
    expect(zhInput).toContain('checked=""');
    expect(zhInput).toContain('aria-labelledby="settings-lang-title-zh"');
    expect(zhInput).toContain('aria-describedby="settings-lang-desc-zh"');
    expect(zhInput).not.toContain('aria-label=');
    expect(enInput).toBeDefined();
    expect(enInput).not.toContain('checked=""');
    expect(enInput).toContain('aria-labelledby="settings-lang-title-en"');
    expect(enInput).toContain('aria-describedby="settings-lang-desc-en"');
    expect(enInput).not.toContain('aria-label=');
    expect(html).toContain(DICTIONARY.zh.langZh);
    expect(html).toContain(DICTIONARY.zh.langEn);

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
