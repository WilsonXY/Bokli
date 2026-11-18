"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Language = "zh" | "en";

export const DICTIONARY = {
  zh: {
    closeShort: "结账",
    daysUnit: "天",
    zeroBalanceShort: "无余额填 0",
    blankRevenueZeroShort: "空白按 0",
    expensesTitleShort: "固定支出",
    monthTotal: "本月合计",
    periodTotal: "合计",
    dateLabel: "日期",
    dailySheetsLabel: "每日账单",
    categoryShort: "类别",
    saveShort: "保存",
    confirmRevertTitle: "撤销修改？",
    confirmRevertDesc: "丢弃此账单的全部未保存修改。",
    confirmRevertBtn: "确认撤销",
    returnToday: "回到今天",
    returnTodayShort: "今日",
    recordedSheet: "已记录每日账单",
    noRecordedDays: "本月暂无已记录账单",
    recordedDaysLoading: "正在读取已记录日期…",
    recordedDaysFailed: "记录标记未加载",
    enterBothToClose: "填写两项余额后可结账。",
    cashRevenueShort: "现金",
    tngRevenueShort: "TnG",
    navExpensesShort: "支出",
    awaitingCounts: "待盘点",
    loadingShort: "加载中",
    deleteCostLine: "删除这笔开销",
    optionalBadge: "可选",
    noRevenueWarning: "今日营业收入尚未填写，按 0 计算。确定保存吗？",
    navSheetShort: "记账",
    fieldColon: "：",
    sentenceSeparator: "。",
    profitStatus: "盈利",
    lossStatus: "亏损",
    evenStatus: "收支持平",
    emptyMonthHint: "记下每日账单，在这里查看本月收支。",
    savedExpensesTitle: "明细",
    navSettings: "设置",
    calendarTitle: "选择日期",
    closeCalendar: "关闭日期选择",
    prevMonth: "上个月",
    nextMonth: "下个月",
    recordedDays: "记账天数",
    trendMetric: "趋势数据",
    recordedDatesOnly: "仅已记账日期",
    chartDataBelow: "每日金额与账单链接如下。",
    recordDailySheet: "记录每日账单",
    homeLabel: "Bokli 首页",
    mainNavigation: "主导航",
    skipToContent: "跳至主要内容",
    sheetTitle: "每日账单",
    sheetHint: "记录营业收入，核对当日开销。",
    overviewHint: "查看营业收入、开销与利润。",
    expensesHint: "管理租金、水电与每月固定支出。",
    closeHint: "盘点余额，确认后锁定本月。",
    settingsHint: "选择适合你的显示方式与语言。",
    preferencesLabel: "个人偏好",
    appearanceTitle: "外观",
    appearanceHint: "默认为明亮模式，也可切换为深色。",
    lightMode: "明亮模式",
    darkMode: "深色模式",
    defaultLabel: "默认",
    languageTitle: "语言",
    languageHint: "更改账本的显示语言。",
    accountTitle: "账户",
    signOutHint: "退出后，需要重新登录才能访问账本。",
    signOutDraftHint: "还有未保存的修改。退出会丢弃这些修改。",
    savedOnDevice: "外观与语言偏好会保存在此浏览器。",
    savedStatus: "已保存",
    draftStatus: "未保存",
    newSheetStatus: "新账单",

    roleOperator: "操作员",
    roleAdmin: "管理员",
    // Navigation
    navSheet: "每日账单",
    navDashboard: "经营概览",
    navExpenses: "固定支出",
    navClose: "月度结账",
    // Date & Navigation
    prevDay: "前一天",
    nextDay: "后一天",
    today: "今日",
    klTime: "吉隆坡时间",
    monthLocked: "该月份已结账锁定（仅供查看）",
    viewCalculation: "查看账本计算",
    closeMonthAction: "月度结账",
    closeMonthHint: "盘点余额，确认本月账本",
    // Revenue
    revenueTitle: "营业收入",
    cashRevenue: "现金收入",
    tngRevenue: "TnG 收入",
    totalRevenue: "营业收入",
    // Daily Costs
    costsTitle: "日常开销",
    totalCosts: "日常开销",
    selectCategory: "开销类别",
    costCategory: "开销类别",
    expenseCategory: "支出类别",
    amount: "金额",
    note: "备注",
    noteRequiredBadge: "必填",
    addCostLine: "添加开销",
    noCostsRecorded: "今日暂无开销记录",
    delete: "删除",
    // Categories
    catRestock: "进货",
    catGas: "煤气",
    catTransport: "交通",
    catWagesDaily: "工资",
    catMaintenance: "维修费",
    catOther: "其他",
    // Gross Profit & Save
    grossProfit: "当日毛利润",
    monthGrossProfit: "月度毛利润",
    undoChanges: "撤销修改",
    saveSheet: "保存账单",
    confirmSaveTitle: "确认保存账单？",
    confirmSaveDesc: "请核对所选日期的数据，确认无误后保存。",
    confirmSaveBtn: "确认保存",
    confirmDeleteItemTitle: "确认删除该记录？",
    confirmDeleteItemDesc: "删除后此项金额将不再计入总计。",
    costDeleteDraftDesc: "保存账单后生效。",
    removesRecordSingle: "删除 1 条记录",
    removesRecordPlural: "删除 {count} 条记录",
    confirmDeleteBtn: "确认删除",
    deleteSheetBtn: "删除当日账单",
    confirmDeleteSheetTitle: "确认删除当日账单？",
    confirmDeleteSheetDesc: "将删除这一天的全部记录，包括所有开销明细，删除后无法恢复。屏幕上未保存的修改也会一并丢弃。",
    sheetDate: "日期",
    savedTotalRevenue: "已保存的营业收入",
    savedTotalCosts: "已保存的日常开销",
    deleteSheetSuccess: "当日账单已删除",
    sheetChangedError: "这一天的记录已在别处被修改，未删除。请重新核对后再操作。",
    saving: "保存中...",
    saveError: "保存失败，请检查网络或重试",
    saveFailedDraftKept: "保存失败，修改仍保留。",
    saveRetryHint: "请重试保存，仍失败时请找人帮忙。",
    amountVerificationError: "金额未能通过核对。",
    saveFailedShort: "保存失败",
    loadError: "数据加载失败，请刷新或稍后重试",
    retry: "重试",
    unauthorizedError: "未登录或登录已失效，请重新登录",
    forbiddenError: "没有操作权限",
    monthClosedError: "该月份已结账锁定，无法修改",
    networkError: "网络连接失败，请稍后重试",
    outcomeUnknownError: "不确定是否已保存。请再按一次保存，不会重复记账。",
    invalidAmount: "请输入有效金额",
    otherNoteRequired: "“其他”需填写备注。",
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
    operatingExpenses: "固定支出",
    netProfit: "月度净利润",
    netProfitFormula: "毛利润 − 固定支出",
    revenueSplit: "收入构成",
    noRevenueData: "本月暂无收入数据",
    costDistribution: "日常开销分布",
    noCostData: "本月暂无开销数据",
    dailyTrend: "每日收入趋势",
    dailyCostTrend: "每日开销趋势",
    noDailyEntries: "本月暂无每日账单记录",
    dateCol: "日期",
    sheetRevCol: "营业收入",
    sheetCostCol: "日常开销",
    sheetProfitCol: "毛利润",
    // Expenses
    expensesTitle: "固定支出",
    catRental: "摊位租金",
    catUtilities: "水电杂费",
    catWages: "每月薪资",
    catOpOther: "其他",
    addExpense: "添加支出",
    addExpenseSuccess: "固定支出记录添加成功",
    lastAddSaved: "上次添加已保存",
    lastAddNotSaved: "上次添加未保存，请重新添加",
    deleteExpenseSuccess: "支出记录已删除",
    noExpensesRecorded: "本月暂无固定支出",
    expenseTotal: "固定支出总计",
    monthSelect: "月份",
    // Month Close
    closeTitle: "月度结账",
    closeWarning: "结账后将锁定本月数据，不可修改。",
    cashOnHand: "现金实际余额",
    tngOnHand: "TnG 实际余额",
    expectedNet: "账面净利润",
    actualTotal: "实际总金额",
    reconciliationTitle: "对账",
    revertShort: "撤销",
    reconciliationDiff: "对账差异",
    reconciliationBalanced: "账实相符",
    reconciliationMismatch: "存在差异",
    closeNote: "结账备注",
    closeNotePlaceholder: "如有差异，请务必填写说明",
    confirmEmptyMonth: "本月无账单，确认为空月",
    emptyMonthError: "本月无账单，请先勾选确认为空月",
    varianceNoteRequired: "存在差异，须填写备注。",
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
    // Sign out
    signOut: "退出",
    confirmSignOutTitle: "确认退出登录？",
    confirmSignOutBtn: "确认退出",
  },
  en: {
    closeShort: "Close",
    daysUnit: " days",
    zeroBalanceShort: "No balance? Enter 0",
    blankRevenueZeroShort: "Blank → 0",
    expensesTitleShort: "Expenses",
    monthTotal: "This month",
    periodTotal: "Total",
    dateLabel: "Date",
    dailySheetsLabel: "Daily Sheets",
    categoryShort: "Category",
    saveShort: "Save",
    confirmRevertTitle: "Revert changes?",
    confirmRevertDesc: "Discard all unsaved changes to this Daily Sheet.",
    confirmRevertBtn: "Confirm Revert",
    returnToday: "Return to today",
    returnTodayShort: "Today",
    recordedSheet: "Daily Sheet recorded",
    noRecordedDays: "No Daily Sheets recorded this month",
    recordedDaysLoading: "Loading recorded dates…",
    recordedDaysFailed: "Record marks unavailable",
    enterBothToClose: "Enter both balances to enable Month Close.",
    cashRevenueShort: "Cash",
    tngRevenueShort: "TnG",
    navExpensesShort: "Expenses",
    awaitingCounts: "Awaiting counts",
    loadingShort: "Loading",
    deleteCostLine: "Delete Cost Line",
    optionalBadge: "Optional",
    noRevenueWarning: "Revenue is blank and will count as 0. Save anyway?",
    navSheetShort: "Record",
    fieldColon: ":",
    sentenceSeparator: ". ",
    profitStatus: "Profit",
    lossStatus: "Loss",
    evenStatus: "Break-even",
    emptyMonthHint: "Record a Daily Sheet to start seeing revenue and profit here.",
    savedExpensesTitle: "Records",
    navSettings: "Settings",
    calendarTitle: "Choose date",
    closeCalendar: "Close calendar",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    recordedDays: "Days recorded",
    trendMetric: "Trend metric",
    recordedDatesOnly: "Recorded days only",
    chartDataBelow: "Daily amounts and links to Daily Sheets follow.",
    recordDailySheet: "Record a Daily Sheet",
    homeLabel: "Bokli home",
    mainNavigation: "Main navigation",
    skipToContent: "Skip to content",
    sheetTitle: "Daily Sheet",
    sheetHint: "Record revenue and review the day's Daily Costs.",
    overviewHint: "Review revenue, costs and profit for the month.",
    expensesHint: "Manage rent, utilities and other Operating Expenses.",
    closeHint: "Count balances, then lock this month.",
    settingsHint: "Choose your appearance and language preferences.",
    preferencesLabel: "Preferences",
    appearanceTitle: "Appearance",
    appearanceHint: "Bright by default. Choose dark mode if you prefer.",
    lightMode: "Bright mode",
    darkMode: "Dark mode",
    defaultLabel: "Default",
    languageTitle: "Language",
    languageHint: "Choose the language used throughout your bookkeeping.",
    accountTitle: "Account",
    signOutHint: "You will need to sign in again to access your records.",
    signOutDraftHint: "You have unsaved changes. Signing out will discard them.",
    savedOnDevice: "Appearance and language preferences are saved in this browser.",
    savedStatus: "Saved",
    draftStatus: "Unsaved",
    newSheetStatus: "New sheet",

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
    viewCalculation: "View calculation",
    closeMonthAction: "Month Close",
    closeMonthHint: "Count balances and confirm the month",
    tngRevenue: "TnG Revenue",
    totalRevenue: "Revenue",
    // Daily Costs
    costsTitle: "Daily Costs",
    totalCosts: "Daily Costs",
    selectCategory: "Cost Category",
    costCategory: "Cost Category",
    expenseCategory: "Expense Category",
    amount: "Amount",
    note: "Note",
    noteRequiredBadge: "Required",
    addCostLine: "Add Cost",
    noCostsRecorded: "No costs recorded for today",
    delete: "Delete",
    // Categories
    catRestock: "Restock",
    catGas: "Gas",
    catTransport: "Transport",
    catWagesDaily: "Wages",
    catMaintenance: "Maintenance",
    catOther: "Other",
    // Gross Profit & Save
    grossProfit: "Gross Profit",
    monthGrossProfit: "Gross Profit",
    undoChanges: "Revert changes",
    saveSheet: "Save Sheet",
    confirmSaveTitle: "Save this Daily Sheet?",
    confirmSaveDesc: "Review the selected date and figures before saving.",
    confirmSaveBtn: "Confirm & Save",
    confirmDeleteItemTitle: "Delete this item?",
    confirmDeleteItemDesc: "This amount will no longer count toward the total.",
    costDeleteDraftDesc: "Takes effect when you save the Daily Sheet.",
    removesRecordSingle: "Deletes 1 record",
    removesRecordPlural: "Deletes {count} records",
    confirmDeleteBtn: "Delete",
    deleteSheetBtn: "Delete this Daily Sheet",
    confirmDeleteSheetTitle: "Delete this Daily Sheet?",
    confirmDeleteSheetDesc: "This removes the whole day's record, including all its Cost Lines. It cannot be undone. Any unsaved edits on screen will be discarded.",
    sheetDate: "Date",
    savedTotalRevenue: "Saved Total Revenue",
    savedTotalCosts: "Saved Total Costs",
    deleteSheetSuccess: "Daily Sheet deleted",
    sheetChangedError: "This day's record was changed elsewhere, so nothing was deleted. Please review it again.",
    saving: "Saving...",
    saveError: "Failed to save, please retry",
    saveFailedDraftKept: "Not saved. Your draft is kept.",
    saveRetryHint: "Try saving again. If it still fails, ask for help.",
    amountVerificationError: "The amounts could not be verified.",
    saveFailedShort: "Save failed",
    loadError: "Failed to load data. Please refresh or try again later.",
    retry: "Retry",
    unauthorizedError: "Unauthorized or session expired. Please log in again.",
    forbiddenError: "Forbidden: You do not have permission to perform this action.",
    monthClosedError: "This month is closed and locked from changes.",
    networkError: "Network connection error. Please try again later.",
    outcomeUnknownError: "Not sure it saved. Press save again; it won't be counted twice.",
    invalidAmount: "Please enter a valid amount",
    otherNoteRequired: "Add a note for Other.",
    // Dashboard
    overviewTitle: "Overview",
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
    netProfitFormula: "Gross Profit − Operating Expenses",
    revenueSplit: "Revenue Composition",
    noRevenueData: "No revenue data for this month",
    costDistribution: "Daily Cost Distribution",
    noCostData: "No cost data for this month",
    dailyTrend: "Daily Revenue Trend",
    dailyCostTrend: "Daily Cost Trend",
    noDailyEntries: "No daily sheets for this month",
    dateCol: "Date",
    sheetRevCol: "Revenue",
    sheetCostCol: "Daily Costs",
    sheetProfitCol: "Gross",
    // Expenses
    expensesTitle: "Operating Expenses",
    catRental: "Stall Rent",
    catUtilities: "Utilities",
    catWages: "Monthly Wages",
    catOpOther: "Other",
    addExpense: "Add Expense",
    addExpenseSuccess: "Expense added successfully",
    lastAddSaved: "Last add was saved",
    lastAddNotSaved: "Last add not saved, add again",
    deleteExpenseSuccess: "Expense deleted",
    noExpensesRecorded: "No operating expenses recorded for this month",
    expenseTotal: "Total Expenses",
    monthSelect: "Month",
    // Month Close
    closeTitle: "Month Close",
    closeWarning: "Closing will lock this month from edits.",
    cashOnHand: "Physical Cash Counted",
    tngOnHand: "TnG Ending Balance",
    expectedNet: "Book Net Profit",
    actualTotal: "Total Counted",
    reconciliationTitle: "Reconciliation",
    revertShort: "Revert",
    reconciliationDiff: "Reconciliation Variance",
    reconciliationBalanced: "Balanced",
    reconciliationMismatch: "Balances differ",
    closeNote: "Close Note",
    closeNotePlaceholder: "Required if variance is detected",
    confirmEmptyMonth: "No sheets, confirm close empty month",
    emptyMonthError: "No sheets recorded. Check confirm empty month to proceed.",
    varianceNoteRequired: "Variance detected. A note is required.",
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
    // Sign out
    signOut: "Sign Out",
    confirmSignOutTitle: "Sign out of Bokli?",
    confirmSignOutBtn: "Sign Out",
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

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
  }, [lang]);

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

/**
 * The structured error body every API route now returns: `code` is the stable
 * protocol, `error` is English prose kept for logs and legacy fallback.
 */
export interface ApiErrorPayload {
  error?: string | null;
  code?: string | null;
}

/**
 * Reads the payload back out of a caught value: client code throws
 * `Object.assign(new Error(data.error), { code: data.code })`. Same property
 * reads as the former inline `{ error: err.message, code: err.code }`.
 */
export function apiErrorPayloadFrom(err: unknown): ApiErrorPayload {
  const { message, code } = err as { message?: string; code?: string | null };
  return { error: message, code };
}

/**
 * The API error protocol: stable error code -> i18n key.
 *
 * This record is the ONLY place a server error code becomes a user-facing
 * string. `notFound` and `futureDate` have no dedicated i18n case, so they
 * intentionally land on the generic save error rather than inventing one.
 */
export const API_ERROR_CODE_TO_KEY: Record<string, keyof TranslationMap> = {
  unauthorized: "unauthorizedError",
  identityChanged: "unauthorizedError",
  forbidden: "forbiddenError",
  monthClosed: "monthClosedError",
  network: "networkError",
  outcomeUnknown: "outcomeUnknownError",
  otherNoteRequired: "otherNoteRequired",
  varianceNoteRequired: "varianceNoteRequired",
  reopenReasonRequired: "reopenReasonRequired",
  invalidAmount: "invalidAmount",
  notFound: "saveError",
  futureDate: "saveError",
  sheetChanged: "sheetChangedError",
  saveError: "saveError",
};

/**
 * Translates an API error for display.
 *
 * Prefers the structured `code`; the English-prose substring matcher below is
 * ONLY a fallback for codeless errors (client-side failures, legacy or
 * deliberately codeless 400s). Substring matching on prose is what used to
 * collide "note is required when Operating Expense type is 'other'" with the
 * Reconciliation variance message — a coded error never reaches it.
 */
export function translateApiError(
  error: string | ApiErrorPayload | undefined | null,
  t: TranslationMap
): string {
  const payload: ApiErrorPayload =
    typeof error === "string" ? { error } : error ?? {};

  if (payload.code) {
    const key = API_ERROR_CODE_TO_KEY[payload.code];
    if (key) return t[key];
  }

  const message = payload.error;
  if (!message) return t.saveError;
  const lower = message.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    lower.includes("not logged in")
  ) {
    return t.unauthorizedError;
  }
  if (lower.includes("forbidden") || lower.includes("permission")) {
    return t.forbiddenError;
  }
  if (lower.includes("closed") || lower.includes("locked")) {
    return t.monthClosedError;
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return t.networkError;
  }
  if (/category is .other./i.test(lower)) {
    return t.otherNoteRequired;
  }
  if (lower.includes("note is required") || lower.includes("variance")) {
    return t.varianceNoteRequired;
  }
  if (lower.includes("reopen")) {
    return t.reopenReasonRequired;
  }
  if (lower.includes("invalid amount") || lower.includes("amount")) {
    return t.invalidAmount;
  }
  return t.saveError;
}
