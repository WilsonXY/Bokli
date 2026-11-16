"use client";

import { ActionIcon } from "@/components/ActionIcon";
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
            <input type="radio" name="appearance" value={option} aria-label={option === "light" ? t.lightMode : t.darkMode} checked={theme === option} onChange={() => setTheme(option)} />
            <span className="appearance-symbol"><ActionIcon name={option === "light" ? "sun" : "moon"} size={30} /></span>
            <span className="sr-only">{option === "light" ? t.defaultLabel : t.darkMode}</span>
          </label>)}
        </fieldset>
      </section>
      <section className="settings-section">
        <div><h2>{t.languageTitle}</h2><p>{t.languageHint}</p></div>
        <fieldset className="language-options"><legend className="sr-only">{t.languageTitle}</legend>
          <label><input type="radio" name="language" checked={lang === "zh"} onChange={() => setLang("zh")} /><span lang="zh-Hans">简体中文</span></label>
          <label><input type="radio" name="language" checked={lang === "en"} onChange={() => setLang("en")} /><span lang="en">English</span></label>
        </fieldset>
      </section>
      <section className="settings-section account-section"><button type="button" className="secondary-button text-finance-loss signout-icon" aria-label={t.signOut} title={t.signOut} onClick={() => dialog.current?.showModal()}><ActionIcon name="logout" /></button></section>
      <p className="preferences-footnote">{t.savedOnDevice}</p>
      <dialog ref={dialog} className="account-dialog" aria-labelledby="signout-title" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
        <h2 id="signout-title">{t.confirmSignOutTitle}</h2><p>{hasDrafts ? t.signOutDraftHint : t.signOutHint}</p>
        <div className="dialog-actions"><button autoFocus className="secondary-button" aria-label={t.cancel} onClick={() => dialog.current?.close()}><ActionIcon name="close" /></button><button className="primary-button" aria-label={t.confirmSignOutBtn} onClick={() => { discardAll(); window.location.assign("/cdn-cgi/access/logout"); }}><ActionIcon name="logout" /></button></div>
      </dialog>
    </div>
  );
}
