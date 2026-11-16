"use client";

import { useUnsavedDrafts } from "@/components/DraftProvider";
import { useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { useAppearance } from "@/components/AppearanceProvider";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useAppearance();
  const { hasDrafts, discardAll } = useUnsavedDrafts();
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="settings-page page-stack">
      <div className="page-heading"><div><p className="eyebrow">{t.preferencesLabel}</p><h1>{t.navSettings}</h1><p className="page-description">{t.settingsHint}</p></div></div>
      <section className="settings-section">
        <div><h2>{t.appearanceTitle}</h2><p>{t.appearanceHint}</p></div>
        <fieldset className="preference-options"><legend className="sr-only">{t.appearanceTitle}</legend>
          {(["light", "dark"] as const).map(option => <label key={option} className="appearance-choice">
            <input type="radio" name="appearance" value={option} checked={theme === option} onChange={() => setTheme(option)} />
            <span aria-hidden="true" className={`theme-swatch theme-swatch-${option}`}><i /><i /><i /></span>
            <span>{option === "light" ? t.lightMode : t.darkMode}{option === "light" && <small>{t.defaultLabel}</small>}</span>
          </label>)}
        </fieldset>
      </section>
      <section className="settings-section">
        <div><h2>{t.languageTitle}</h2><p>{t.languageHint}</p></div>
        <fieldset className="language-options"><legend className="sr-only">{t.languageTitle}</legend>
          <label><input type="radio" name="language" checked={lang === "zh"} onChange={() => setLang("zh")} /><span lang="zh-Hans">简体中文</span><small>中文</small></label>
          <label><input type="radio" name="language" checked={lang === "en"} onChange={() => setLang("en")} /><span lang="en">English</span><small>EN</small></label>
        </fieldset>
      </section>
      <section className="settings-section account-section"><div><h2>{t.accountTitle}</h2><p>{t.signOutHint}</p></div><button type="button" className="secondary-button text-finance-loss" onClick={() => dialog.current?.showModal()}>{t.signOut}</button></section>
      <p className="preferences-footnote">{t.savedOnDevice}</p>
      <dialog ref={dialog} className="account-dialog" aria-labelledby="signout-title" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
        <h2 id="signout-title">{t.confirmSignOutTitle}</h2><p>{hasDrafts ? t.signOutDraftHint : t.signOutHint}</p>
        <div className="dialog-actions"><button autoFocus className="secondary-button" onClick={() => dialog.current?.close()}>{t.cancel}</button><button className="primary-button" onClick={() => { discardAll(); window.location.assign("/cdn-cgi/access/logout"); }}>{t.confirmSignOutBtn}</button></div>
      </dialog>
    </div>
  );
}
