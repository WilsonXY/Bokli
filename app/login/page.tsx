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

  // Tactile wave / ripple effect on all .btn-wave interactive elements on the login page
  React.useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const target = (e.target as HTMLElement)?.closest(".btn-wave") as HTMLElement | null;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      const wave = document.createElement("span");
      wave.className = "ripple-wave";
      wave.style.width = `${size}px`;
      wave.style.height = `${size}px`;
      wave.style.left = `${x}px`;
      wave.style.top = `${y}px`;

      target.appendChild(wave);
      setTimeout(() => {
        wave.remove();
      }, 600);
    }

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

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
      <div className="w-full max-w-xs sm:max-w-sm bg-white border border-surface-border rounded-2xl p-6 sm:p-7 shadow-sm relative">
        {/* Language Switcher Top Right */}
        <div className="absolute top-4 right-4 flex items-center bg-surface-subtle border border-surface-border rounded-lg p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setLang("zh")}
            aria-label="切换到中文 (Switch to Chinese)"
            className={`min-h-[30px] min-w-[38px] px-2.5 py-0.5 rounded-md btn-wave transition-all ${
              lang === "zh"
                ? "bg-white text-brand-broccoli font-bold shadow-xs"
                : "text-ink-muted hover:text-ink-primary font-medium"
            }`}
          >
            中文
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            aria-label="Switch to English"
            className={`min-h-[30px] min-w-[38px] px-2.5 py-0.5 rounded-md btn-wave transition-all ${
              lang === "en"
                ? "bg-white text-brand-broccoli font-bold shadow-xs"
                : "text-ink-muted hover:text-ink-primary font-medium"
            }`}
          >
            EN
          </button>
        </div>

        {/* Brand Header */}
        <div className="text-center mb-6 mt-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-broccoli-light mb-2.5 text-2xl select-none">
            🥦
          </div>
          <h1 className="text-xl font-extrabold text-ink-primary tracking-tight">
            {t.loginTitle}
          </h1>
        </div>

        {error && (
          <div className="mb-4 py-2.5 px-3.5 rounded-lg bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-medium animate-slide-down">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs font-bold text-ink-secondary mb-1.5"
            >
              {t.username}
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t.usernamePlaceholder}
              autoComplete="username"
              className="w-full h-11 px-3.5 rounded-xl border border-surface-border-strong bg-white text-ink-primary text-base placeholder:text-ink-muted/50 focus:outline-none focus:border-brand-broccoli focus:ring-2 focus:ring-brand-broccoli/30 transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-bold text-ink-secondary mb-1.5"
            >
              {t.password}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
              autoComplete="current-password"
              className="w-full h-11 px-3.5 rounded-xl border border-surface-border-strong bg-white text-ink-primary text-base placeholder:text-ink-muted/50 focus:outline-none focus:border-brand-broccoli focus:ring-2 focus:ring-brand-broccoli/30 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-2 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark btn-wave text-white font-bold text-sm tracking-wide transition-colors flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60"
          >
            {loading ? t.signingIn : t.signIn}
          </button>
        </form>
      </div>
    </div>
  );
}
