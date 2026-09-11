"use client";

import React, { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { sanitizeCallbackUrl } from "@/lib/url";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");
  const targetUrl =
    !callbackUrl || callbackUrl === "/" || callbackUrl.startsWith("/login")
      ? "/dashboard"
      : sanitizeCallbackUrl(callbackUrl, "/dashboard");

  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

      router.push(targetUrl);
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
            <div className="relative flex items-center">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.passwordPlaceholder}
                autoComplete="current-password"
                className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-surface-border-strong bg-white text-ink-primary text-base placeholder:text-ink-muted/50 focus:outline-none focus:border-brand-broccoli focus:ring-2 focus:ring-brand-broccoli/30 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t.hidePassword : t.showPassword}
                title={showPassword ? t.hidePassword : t.showPassword}
                className="absolute right-0 top-0 bottom-0 w-11 flex items-center justify-center text-ink-muted hover:text-ink-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 rounded-r-xl"
              >
                {showPassword ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                )}
              </button>
            </div>
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
