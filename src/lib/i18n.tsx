"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Language = "zh" | "en";

export const DICTIONARY = {
  zh: {
    brandSubtitle: "家庭摊位记账",
    roleOperator: "操作员",
    roleAdmin: "管理员",
    // Navigation
    navSheet: "记账",
    navDashboard: "概览",
    navExpenses: "支出",
    navClose: "结账",
    // Date & Navigation
    prevDay: "前一天",
    nextDay: "后一天",
    today: "今日",
    klTime: "吉隆坡时间",
    monthLocked: "该月份已结账锁定（仅供查看）",
    // Revenue
    revenueTitle: "营业收入",
    cashRevenue: "现金收入",
    cashSub: "纸币与硬币",
    tngRevenue: "Touch 'n Go 收入",
    tngSub: "电子钱包",
    totalRevenue: "营业总额",
    // Daily Costs
    costsTitle: "日常开销明细",
    totalCosts: "开销总计",
    selectCategory: "支出类别",
    amount: "金额",
    note: "备注",
    noteOptional: "可选备注",
    noteRequired: "请填写具体开销说明（必填）",
    noteRequiredBadge: "必填",
    addCostLine: "添加一条开销",
    noCostsRecorded: "今日暂无开销记录",
    delete: "删除",
    // Categories
    catRestock: "进货",
    catGas: "煤气",
    catTransport: "交通",
    catWagesDaily: "每日工资",
    catOther: "其他",
    // Gross Profit & Save
    grossProfit: "当日毛利润",
    saveSheet: "保存账单",
    saving: "保存中...",
    saveSuccess: "今日账单保存成功",
    saveError: "保存失败，请检查网络或重试",
    invalidAmount: "请输入有效的开销金额",
    otherNoteRequired: "类别为'其他'时，必须填写备注说明",
    // Login
    loginTitle: "Bokli 簿里",
    loginSubtitle: "家庭摊位记账 · 专属登录",
    username: "账号",
    password: "密码",
    signIn: "进入账本",
    signingIn: "登录中...",
    loginError: "账号或密码不正确",
    loginNetworkError: "登录失败，请重试",
    sessionHint: "内部专用 · 约30天长效免登录",
  },
  en: {
    brandSubtitle: "Food Stall Ops",
    roleOperator: "Operator",
    roleAdmin: "Admin",
    // Navigation
    navSheet: "Daily Sheet",
    navDashboard: "Overview",
    navExpenses: "Expenses",
    navClose: "Month Close",
    // Date & Navigation
    prevDay: "Prev Day",
    nextDay: "Next Day",
    today: "Today",
    klTime: "Asia/Kuala_Lumpur",
    monthLocked: "Month closed and locked (Read-only)",
    // Revenue
    revenueTitle: "Revenue",
    cashRevenue: "Cash Revenue",
    cashSub: "Cash & Coins",
    tngRevenue: "Touch 'n Go Revenue",
    tngSub: "E-Wallet",
    totalRevenue: "Total Revenue",
    // Daily Costs
    costsTitle: "Daily Costs",
    totalCosts: "Total Costs",
    selectCategory: "Cost Category",
    amount: "Amount",
    note: "Note",
    noteOptional: "Optional note",
    noteRequired: "Please specify description (Required)",
    noteRequiredBadge: "Required",
    addCostLine: "Add Cost Line",
    noCostsRecorded: "No costs recorded for today",
    delete: "Delete",
    // Categories
    catRestock: "Restock",
    catGas: "Gas",
    catTransport: "Transport",
    catWagesDaily: "Daily Wages",
    catOther: "Other",
    // Gross Profit & Save
    grossProfit: "Day's Gross Profit",
    saveSheet: "Save Sheet",
    saving: "Saving...",
    saveSuccess: "Daily sheet saved successfully",
    saveError: "Failed to save, please retry",
    invalidAmount: "Please enter a valid cost amount",
    otherNoteRequired: "Note is required when category is 'Other'",
    // Login
    loginTitle: "Bokli",
    loginSubtitle: "Food Stall Bookkeeping · Sign In",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    signingIn: "Signing in...",
    loginError: "Invalid username or password",
    loginNetworkError: "Sign-in failed, please retry",
    sessionHint: "Internal stall use · ~30-day persistent session",
  },
};

export type TranslationMap = Record<keyof (typeof DICTIONARY)["zh"], string>;

type I18nContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationMap;
};

const I18nContext = createContext<I18nContextType>({
  lang: "zh",
  setLang: () => {},
  t: DICTIONARY.zh,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("zh");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("bokli_lang");
      if (stored === "zh" || stored === "en") {
        setLangState(stored);
      }
    } catch {
      // localStorage unavailable (SSR/incognito)
    }
  }, []);

  const setLang = (nextLang: Language) => {
    setLangState(nextLang);
    try {
      localStorage.setItem("bokli_lang", nextLang);
    } catch {
      // Ignore
    }
  };

  return (
    <I18nContext.Provider
      value={{
        lang,
        setLang,
        t: DICTIONARY[lang],
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
