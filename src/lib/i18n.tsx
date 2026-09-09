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
    noteOptional: "备注 (可选)",
    noteRequired: "请填写具体开销说明（必填）",
    noteRequiredBadge: "必填",
    addCostLine: "添加开销",
    noCostsRecorded: "今日暂无开销记录",
    delete: "删除",
    // Categories
    catRestock: "进货",
    catGas: "煤气",
    catTransport: "交通",
    catWagesDaily: "员工工资",
    catOther: "其他",
    // Gross Profit & Save
    grossProfit: "当日毛利润",
    saveSheet: "保存账单",
    saving: "保存中...",
    saveSuccess: "今日账单保存成功",
    saveError: "保存失败，请检查网络或重试",
    invalidAmount: "请输入有效的开销金额",
    otherNoteRequired: "类别为'其他'时，必须填写备注说明",
    // Dashboard
    overviewTitle: "经营概览",
    monthTiles: "月份卡片",
    currentViewing: "当前查看",
    noMonthsRecorded: "暂无历史月份记录",
    monthSummary: "月度概况",
    openStatus: "进行中",
    closedStatus: "已结账",
    reopenedStatus: "已重开",
    grossProfitFormula: "毛利润（营业收入 - 日常开销）",
    operatingExpenses: "固定运营支出",
    netProfit: "本月净利润",
    netProfitFormula: "毛利润 - 固定支出",
    revenueSplit: "收入构成 (Cash / TnG)",
    noRevenueData: "本月暂无收入数据",
    costDistribution: "日常开销分布",
    noCostData: "本月暂无开销数据",
    dailyTrend: "每日收支趋势",
    noDailyEntries: "本月暂无每日账单记录",
    dateCol: "日期",
    sheetRevCol: "总收入",
    sheetCostCol: "总开销",
    sheetProfitCol: "毛利润",
    // Expenses
    expensesTitle: "固定运营支出",
    catRental: "摊位租金",
    catUtilities: "水电杂费",
    catWages: "每月薪资",
    catOpOther: "其他杂项",
    addExpense: "添加支出",
    addExpenseSuccess: "固定支出记录添加成功",
    deleteExpenseSuccess: "支出记录已删除",
    noExpensesRecorded: "本月暂无固定运营支出",
    expenseTotal: "固定支出总计",
    monthSelect: "月份",
    // Month Close
    closeTitle: "月度结账与对账",
    closeWarning: "结账后将锁定本月数据，不可修改。",
    cashOnHand: "实际现金盘点",
    tngOnHand: "Touch 'n Go 期末余额",
    expectedNet: "账面净利润",
    actualTotal: "实点总金额",
    reconciliationDiff: "对账差异",
    reconciliationBalanced: "账实相符 (平账)",
    reconciliationMismatch: "存在差异 (需填写说明)",
    closeNote: "结账备注",
    closeNoteOptional: "结账说明 (可选)",
    closeNotePlaceholder: "如有差异，请务必填写说明",
    confirmEmptyMonth: "本月无账单，确认结空月",
    emptyMonthError: "本月无账单，请先勾选确认结空月",
    varianceNoteRequired: "实点总金额与账面净利润存在差异，必须填写结账备注说明原因。",
    reopenReasonRequired: "必须填写重新开账原因说明。",
    cancel: "取消",
    btnPerformClose: "结账本月",
    closingMonth: "结账中...",
    closeSuccess: "月度结账成功，账本已锁定",
    reopenTitle: "重新开账（仅管理员）",
    reopenReason: "重开原因",
    reopenPlaceholder: "请说明为何需要重新开账",
    btnPerformReopen: "确认重新开账",
    reopening: "处理中...",
    reopenSuccess: "月份已重新开账，允许继续编辑",
    closedAtLabel: "结账时间",
    reopenedAtLabel: "重开时间",
    reasonLabel: "重开原因",
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
    noteOptional: "Note (optional)",
    noteRequired: "Please specify description (Required)",
    noteRequiredBadge: "Required",
    addCostLine: "Add Cost",
    noCostsRecorded: "No costs recorded for today",
    delete: "Delete",
    // Categories
    catRestock: "Restock",
    catGas: "Gas",
    catTransport: "Transport",
    catWagesDaily: "Staff Wages",
    catOther: "Other",
    // Gross Profit & Save
    grossProfit: "Day's Gross Profit",
    saveSheet: "Save Sheet",
    saving: "Saving...",
    saveSuccess: "Daily sheet saved successfully",
    saveError: "Failed to save, please retry",
    invalidAmount: "Please enter a valid cost amount",
    otherNoteRequired: "Note is required when category is 'Other'",
    // Dashboard
    overviewTitle: "Business Overview",
    monthTiles: "Month Tiles",
    currentViewing: "Viewing",
    noMonthsRecorded: "No recorded months yet",
    monthSummary: "Monthly Summary",
    openStatus: "In Progress",
    closedStatus: "Closed",
    reopenedStatus: "Reopened",
    grossProfitFormula: "Gross Profit (Revenue - Costs)",
    operatingExpenses: "Operating Expenses",
    netProfit: "Net Profit",
    netProfitFormula: "Gross Profit - Operating",
    revenueSplit: "Cash vs TnG Split",
    noRevenueData: "No revenue data for this month",
    costDistribution: "Cost Distribution",
    noCostData: "No cost data for this month",
    dailyTrend: "Daily Trend",
    noDailyEntries: "No daily sheets for this month",
    dateCol: "Date",
    sheetRevCol: "Revenue",
    sheetCostCol: "Costs",
    sheetProfitCol: "Gross",
    // Expenses
    expensesTitle: "Operating Expenses",
    catRental: "Stall Rent",
    catUtilities: "Utilities",
    catWages: "Monthly Wages",
    catOpOther: "Other Expenses",
    addExpense: "Add Expense",
    addExpenseSuccess: "Expense added successfully",
    deleteExpenseSuccess: "Expense deleted",
    noExpensesRecorded: "No operating expenses recorded for this month",
    expenseTotal: "Total Expenses",
    monthSelect: "Month",
    // Month Close
    closeTitle: "Month Close & Reconciliation",
    closeWarning: "Closing will lock this month from edits.",
    cashOnHand: "Physical Cash Counted",
    tngOnHand: "Touch 'n Go Ending Balance",
    expectedNet: "Book Net Profit",
    actualTotal: "Total Counted",
    reconciliationDiff: "Reconciliation Variance",
    reconciliationBalanced: "Balanced (No discrepancy)",
    reconciliationMismatch: "Variance Detected (Note required)",
    closeNote: "Close Note",
    closeNoteOptional: "Close note (optional)",
    closeNotePlaceholder: "Required if variance is detected",
    confirmEmptyMonth: "No sheets, confirm close empty month",
    emptyMonthError: "No sheets recorded. Check confirm empty month to proceed.",
    varianceNoteRequired: "Variance detected between counted total and book net profit. A note is required.",
    reopenReasonRequired: "Reason is required to reopen this month.",
    cancel: "Cancel",
    btnPerformClose: "Close Month",
    closingMonth: "Closing...",
    closeSuccess: "Month closed and locked successfully",
    reopenTitle: "Reopen Month (Admin Only)",
    reopenReason: "Reopen Reason",
    reopenPlaceholder: "Explain why this month must be reopened",
    btnPerformReopen: "Confirm Reopen",
    reopening: "Reopening...",
    reopenSuccess: "Month reopened successfully, editing permitted",
    closedAtLabel: "Closed At",
    reopenedAtLabel: "Reopened At",
    reasonLabel: "Reason",
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
