"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
        setError("账号或密码不正确 (Invalid username or password)");
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("登录失败，请重试 (Sign-in failed, please try again)");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-sm bg-white border border-surface-border rounded-2xl p-6 sm:p-8 shadow-sm">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-broccoli-light mb-3 text-3xl select-none">
            🥦
          </div>
          <h1 className="text-2xl font-extrabold text-ink-primary tracking-tight">
            Bokli 簿里
          </h1>
          <p className="text-xs text-ink-muted mt-1">
            家庭摊位记账 · 专属登录 (Family Stall Sign In)
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-finance-loss-light border border-finance-loss-border text-xs text-finance-loss font-semibold">
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
              账号 (Username)
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="mom / katte"
              autoComplete="username"
              className="w-full h-12 px-3.5 rounded-xl border border-surface-border-strong bg-white text-ink-primary text-sm focus:outline-none focus:border-brand-broccoli focus:ring-2 focus:ring-brand-broccoli-light transition-all"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-bold text-ink-secondary mb-1.5"
            >
              密码 (Password)
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full h-12 px-3.5 rounded-xl border border-surface-border-strong bg-white text-ink-primary text-sm focus:outline-none focus:border-brand-broccoli focus:ring-2 focus:ring-brand-broccoli-light transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-brand-broccoli hover:bg-brand-broccoli-dark active:scale-[0.99] text-white font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
          >
            {loading ? (
              <span>登录中... (Signing in...)</span>
            ) : (
              <>
                <span>进入账本 (Enter Ledger)</span>
                <span>→</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-surface-border text-center">
          <p className="text-[11px] text-ink-muted">
            内部专用 · 约30天长效免登录 (30-day persistent session)
          </p>
        </div>
      </div>
    </div>
  );
}
