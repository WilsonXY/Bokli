"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        username: username.trim(),
        password,
        redirect: false,
      });

      if (!res || res.error) {
        setError(t.loginError);
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(t.loginNetworkError);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col justify-center items-center px-4 py-6">
      <div className="w-full max-w-xs sm:max-w-sm bg-white border border-surface-border rounded-xl p-5 sm:p-6 shadow-xs relative">
        {/* Language Switcher Top Right */}
        <div className="absolute top-3.5 right-3.5 flex items-center bg-surface-subtle border border-surface-border rounded-lg p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setLang("zh")}
            className={`px-1.5 py-0.5 rounded font-medium transition-all ${
              lang === "zh"
                ? "bg-white text-brand-broccoli font-semibold shadow-xs"
                : "text-ink-muted hover:text-ink-primary"
            }`}
          >
            中文
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className={`px-1.5 py-0.5 rounded font-medium transition-all ${
              lang === "en"
                ? "bg-white text-brand-broccoli font-semibold shadow-xs"
                : "text-ink-muted hover:text-ink-primary"
            }`}
          >
            EN
          </button>
        </div>

        {/* Brand Header */}
        <div className="text-center mb-5 mt-1">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-brand-broccoli-light mb-2 text-2xl select-none">
            🥦
          </div>
          <h1 className="text-lg font-bold text-ink-primary tracking-tight">
            {t.loginTitle}
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {t.loginSubtitle}
          </p>
        </div>

        {error && (
          <div className="mb-3.5 py-2 px-3 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label
              htmlFor="username"
              className="block text-xs font-semibold text-ink-secondary mb-1"
            >
              {t.username}
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="mom / katte"
              autoComplete="username"
              className="w-full h-10 px-3 rounded-lg border border-surface-border-strong bg-white text-ink-primary text-sm focus:outline-none focus:border-brand-broccoli transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold text-ink-secondary mb-1"
            >
              {t.password}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full h-10 px-3 rounded-lg border border-surface-border-strong bg-white text-ink-primary text-sm focus:outline-none focus:border-brand-broccoli transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-brand-broccoli hover:bg-brand-broccoli-dark text-white font-semibold text-xs tracking-wide transition-colors flex items-center justify-center gap-1 shadow-xs disabled:opacity-50"
          >
            {loading ? t.signingIn : t.signIn}
          </button>
        </form>

        <div className="mt-5 pt-3 border-t border-surface-border text-center">
          <p className="text-[10px] text-ink-muted">
            {t.sessionHint}
          </p>
        </div>
      </div>
    </div>
  );
}
