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
    navSettings: "设置",
    navSidebarLabel: "侧边导航",
    navPrimaryLabel: "主导航",
    navBottomLabel: "底部导航",
    skipToMain: "跳至主要内容",
    // Date & Navigation
    prevDay: "前一天",
    nextDay: "后一天",
    datePickerLabel: "选择日期",
    prevMonthLabel: "上个月",
    nextMonthLabel: "下个月",
    today: "今日",
    jumpToToday: "回到今日",
    jumpToTodayShort: "回今天",
    recordTodaySheet: "记今日账",
    recordTodayShort: "记今日账",
    klTime: "马来西亚时间 (GMT+8)",
    monthLocked: "该月份已结账锁定（仅供查看）",
    // Daily Sheet
    dailySheetTitle: "每日账单",
    revenueTitle: "营业收入",
    cashRevenue: "现金收入",
    tngRevenue: "TnG 收入",
    totalRevenue: "营业总额",
    // Daily Costs
    costsTitle: "日常开销",
    totalCosts: "日常开销",
    selectCategory: "开销类别",
    costCategory: "开销类别",
    expenseCategory: "支出类别",
    amount: "金额",
    note: "备注",
    noteOptional: "备注（可选）",
    noteRequired: "请填写具体开销说明（必填）",
    noteRequiredBadge: "必填",
    addCostLine: "添加开销",
    noCostsRecorded: "当日暂无开销记录",
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
    grossProfitShort: "当日毛利润",
    monthGrossProfit: "本月毛利润",
    daySummaryTitle: "当日结算",
    newSheetState: "未录入",
    unsavedChanges: "未保存修改",
    unsavedShort: "未保存",
    savedState: "已保存",
    discardChanges: "放弃修改",
    discardShort: "放弃",
    discardDraftDesc: "当前账单上所有未保存的修改将被放弃。",
    discardChangesBtn: "放弃修改",
    saveSheet: "保存账单",
    saveSheetShort: "保存",
    confirmSaveTitle: "确认保存当日账单？",
    confirmSaveDesc: "请核对当日营业数据，确认无误后点击保存。",
    confirmSaveBtn: "确认保存",
    confirmDeleteCostLineTitle: "确认删除该项日常开销？",
    confirmDeleteCostLineDesc: "删除后此项金额将不再计入当日总计。",
    confirmDeleteItemTitle: "确认删除该项固定支出？",
    confirmDeleteItemDesc: "删除后此项金额将不再计入本月总计。",
    removesRecordSingle: "删除 1 条记录",
    removesRecordPlural: "删除 {count} 条记录",
    confirmDeleteBtn: "确认删除",
    deleting: "删除中...",
    deleteSheetBtn: "删除当日账单",
    confirmDeleteSheetTitle: "确认删除当日账单？",
    confirmDeleteSheetDesc: "将删除这一天的全部记录，包括所有开销明细，删除后无法恢复。屏幕上未保存的修改也会一并丢弃。",
    discardUnsavedTitle: "放弃未保存的修改？",
    discardUnsavedDesc: "当前账单有未保存的修改。离开当前页面将丢弃这些修改，是否继续？",
    discardUnsavedExpenseDesc: "当前固定支出草稿有未保存的填写内容。离开当前页面将丢弃这些内容，是否继续？",
    discardUnsavedExpenseMonthDesc: "当前固定支出草稿有未保存的填写内容。切换月份将丢弃这些内容，是否继续？",
    discardUnsavedCloseDesc: "当前月度结账表单有未保存的填写内容。离开当前页面将丢弃这些内容，是否继续？",
    discardUnsavedCloseMonthDesc: "当前月度结账表单有未保存的填写内容。切换月份将丢弃这些内容，是否继续？",
    keepEditingBtn: "继续编辑",
    discardAndSwitchBtn: "放弃并离开",
    discardAndSwitchMonthBtn: "放弃并切换月份",
    sheetDate: "日期",
    savedTotalRevenue: "已保存的营业总额",
    savedTotalCosts: "已保存的开销总额",
    deleteSheetSuccess: "当日账单已删除",
    sheetChangedError: "这一天的记录已在别处被修改，未删除。请重新核对后再操作。",
    saving: "保存中...",
    saveSuccess: "当日账单保存成功",
    saveError: "保存失败，请检查网络或重试",
    loadError: "数据加载失败，请刷新或稍后重试",
    retry: "重试",
    unauthorizedError: "未登录或登录已失效，请重新登录",
    forbiddenError: "没有操作权限",
    monthClosedError: "该月份已结账锁定，无法修改",
    networkError: "网络连接失败，请稍后重试",
    outcomeUnknownError: "不确定是否已保存。请再按一次保存，不会重复记账。",
    invalidAmount: "请输入有效金额",
    otherNoteRequired: "类别为'其他'时，必须填写备注说明",
    // Dashboard
    overviewTitle: "本月经营概览",
    monthTiles: "月份卡片",
    currentViewing: "当前查看",
    noMonthsRecorded: "暂无历史月份记录",
    monthSummary: "月度概况",
    openStatus: "未结账",
    closedStatus: "已结账",
    reopenedStatus: "已重开",
    grossProfitFormula: "毛利润（营业收入 − 日常开销）",
    operatingExpenses: "固定支出",
    netProfit: "本月净利润",
    netProfitFormula: "毛利润 − 固定支出",
    profitMargin: "净利率",
    shortfallLabel: "亏损",
    dailyCostsCoveredLabel: "日常开销（营业额内）",
    opexCoveredLabel: "固定支出（营业额内）",
    shortfallUncoveredLabel: "超出营业额",
    revenueMarkLabel: "营业额",
    shortfallSummaryCaption: "本月总开支 {outflow}，高于营业额 {revenue}",
    shortfallZeroRevenueCaption: "本月总开支 {outflow}，暂无营业收入",
    chartKeyRecordedZero: "已记 RM 0",
    chartKeyUnrecorded: "未记账",
    chartMetricTabsLabel: "每日趋势切换",
    chartKeyboardHint: "左右方向键切换日期，回车固定，Esc 关闭",
    chartEarlierDays: "较早日期",
    chartLaterDays: "较近日期",
    vsPrevMonth: "较",
    profitFlowTitle: "本月利润构成",
    insightEmpty: "本月尚未录入经营数据，点击「记今日账」开始记账。",
    insightDaysAndTopCost: "已记录 {days} 天营业，{category}占日常开销 {pct}%。",
    insightDaysOnly: "本月已记录 {days} 天营业账单。",
    insightLossCallout: "本月总开支超出营业额 {loss}。",
    dailyAverage: "已记日均",
    peakDay: "最高日",
    prevRecordedDay: "前一个记录日",
    nextRecordedDay: "后一个记录日",
    revenueSplit: "收入构成",
    revenueSplitSub: "现金与 TnG 渠道占比",
    noRevenueData: "本月暂无收入数据",
    costDistribution: "日常开销分布",
    costDistributionSub: "按类别统计本月日常开销",
    noCostData: "本月暂无开销数据",
    dailyTrend: "每日收入趋势",
    dailyCostTrend: "每日开销趋势",
    dailySheetsList: "每日账单明细",
    noDailyEntries: "本月暂无每日账单记录",
    dateCol: "日期",
    daysUnit: "天",
    sheetRevCol: "营业总额",
    sheetCostCol: "日常开销",
    sheetProfitCol: "毛利润",
    // Expenses
    expensesTitle: "固定支出",
    expensesListTitle: "本月支出明细",
    catRental: "摊位租金",
    catUtilities: "水电杂费",
    catWages: "每月薪资",
    catOpOther: "其他",
    addExpense: "添加支出",
    addExpenseSuccess: "固定支出记录添加成功",
    lastAddSaved: "上次添加已保存",
    lastAddNotSaved: "上次添加未保存，请重新添加",
    deleteExpenseSuccess: "固定支出已删除",
    noExpensesRecorded: "本月暂无固定支出",
    expenseTotal: "固定支出总计",
    expensesThisMonthLabel: "本月合计",
    itemUnitSingular: "项",
    itemsUnit: "项",
    grossProfitShareLabel: "占本月毛利润",
    opexShareSentence: "占本月毛利润",
    expensesOverrunCaption: "超出毛利润 {overrun}",
    expensesUncoveredCaption: "无毛利润可覆盖：{amount}",
    grossProfitBoundaryLabel: "本月毛利润",
    monthSelect: "月份",
    // Month Close
    closeTitle: "月度结账与对账",
    bookSummaryTitle: "本月账面汇总",
    reconciliationSection: "实盘对账",
    closeWarning: "结账后本月数据将锁定，重新开账前不可修改。",
    cashOnHand: "现金实际余额",
    tngOnHand: "TnG 实际余额",
    expectedNet: "账面净利润",
    actualTotal: "实际总金额",
    reconciliationDiff: "对账差异",
    reconciliationAwaiting: "待输入实盘余额",
    reconciliationAwaitingHint: "输入现金或 TnG 实际余额以核对差异（未填写项按 RM 0.00 计）",
    blankCountsZeroHint: "未填写项按 RM 0.00 计",
    closeReadyAwaitingHint: "请先输入现金或 TnG 实盘余额后再结账（未填写项按 RM 0.00 计）",
    reconciliationBalanced: "账实相符",
    reconciliationMismatch: "存在差异",
    reconciliationShortBy: "少于账面",
    reconciliationOverBy: "多于账面",
    closeNote: "结账备注",
    closeNoteOptional: "结账说明（可选）",
    closeNotePlaceholder: "存在差异，请写明原因",
    closeNoteExample: "例如：零钱找赎差异、少收现金或未入账杂费",
    confirmEmptyMonth: "本月无账单，确认为空月",
    emptyMonthError: "本月无账单，请先勾选确认为空月",
    varianceNoteRequired: "存在差异，须填写备注。",
    reopenReasonRequired: "必须填写重新开账原因说明。",
    cancel: "取消",
    closeLabel: "关闭",
    btnPerformClose: "结账本月",
    closingMonth: "结账中...",
    closeSuccess: "月度结账成功，账本已锁定",
    reopenTitle: "重新开账（仅管理员）",
    reopenReason: "重开原因",
    reopenPlaceholder: "请说明为何需要重新开账",
    btnPerformReopen: "确认重新开账",
    reopening: "处理中...",
    reopenSuccess: "月份已重新开账，允许继续编辑",
    closeSavedStatusStale: "已结账，但页面状态未更新",
    reopenSavedStatusStale: "已重新开账，但页面状态未更新",
    refreshingStatus: "正在刷新…",
    closeSavedUpdating: "已结账，正在更新页面…",
    reopenSavedUpdating: "已重新开账，正在更新页面…",
    refreshStillFailing: "仍未刷新成功，请重试或重新加载页面",
    closedAtLabel: "结账时间",
    reopenedAtLabel: "重开时间",
    reasonLabel: "重开原因",
    // Settings
    settingsTitle: "设置",
    closeSettings: "关闭设置",
    settingsSubtitle: "管理外观主题、界面语言与当前账号",
    appearanceTitle: "外观主题",
    appearanceDesc: "默认使用明亮模式，适合档口明亮环境清晰读数",
    themeLight: "明亮模式",
    themeLightDesc: "白天使用，清晰易读",
    themeDark: "深色模式",
    themeDarkDesc: "夜间使用，柔和不刺眼",
    languageTitle: "界面语言",
    languageDesc: "切换账本显示语言，立即保存并生效",
    langZh: "简体中文",
    langZhDesc: "中文界面",
    langEn: "English",
    langEnDesc: "英文界面",
    accountTitle: "账号与会话",
    accountRoleLabel: "当前角色",
    ledgerInfoTitle: "账本配置",
    ledgerCurrencyLabel: "记账货币",
    ledgerTimezoneLabel: "营业时区",
    reconciliationChannelsLabel: "对账渠道",
    reconciliationChannelsValue: "现金 + TnG",
    signOutDesc: "退出当前设备上的 Bokli 登录状态",
    // Sign out
    signOut: "退出登录",
    confirmSignOutTitle: "确认退出登录？",
    confirmSignOutBtn: "确认退出",
  },
  en: {
    brandSubtitle: "Food Stall Ledger",
    roleOperator: "Operator",
    roleAdmin: "Admin",
    // Navigation
    navSheet: "Daily Sheet",
    navDashboard: "Overview",
    navExpenses: "Expenses",
    navClose: "Month Close",
    navSettings: "Settings",
    navSidebarLabel: "Sidebar Navigation",
    navPrimaryLabel: "Primary Navigation",
    navBottomLabel: "Bottom Navigation",
    skipToMain: "Skip to main content",
    // Date & Navigation
    prevDay: "Prev Day",
    nextDay: "Next Day",
    datePickerLabel: "Pick a date",
    prevMonthLabel: "Previous Month",
    nextMonthLabel: "Next Month",
    today: "Today",
    jumpToToday: "Jump to Today",
    jumpToTodayShort: "Today",
    recordTodaySheet: "Today's Sheet",
    recordTodayShort: "Today",
    klTime: "Malaysia Time (GMT+8)",
    monthLocked: "Month closed and locked (Read-only)",
    // Daily Sheet
    dailySheetTitle: "Daily Sheet",
    revenueTitle: "Revenue",
    cashRevenue: "Cash Revenue",
    tngRevenue: "TnG Revenue",
    totalRevenue: "Total Revenue",
    // Daily Costs
    costsTitle: "Daily Costs",
    totalCosts: "Daily Costs",
    selectCategory: "Cost Category",
    costCategory: "Cost Category",
    expenseCategory: "Expense Category",
    amount: "Amount",
    note: "Note",
    noteOptional: "Note (optional)",
    noteRequired: "Describe this cost (required)",
    noteRequiredBadge: "Required",
    addCostLine: "Add Cost Line",
    noCostsRecorded: "No Cost Lines recorded for this day",
    delete: "Delete",
    // Categories
    catRestock: "Restock",
    catGas: "Gas",
    catTransport: "Transport",
    catWagesDaily: "Wages",
    catMaintenance: "Maintenance",
    catOther: "Other",
    // Gross Profit & Save
    grossProfit: "Day's Gross Profit",
    grossProfitShort: "Gross Profit",
    monthGrossProfit: "Gross Profit",
    daySummaryTitle: "Day Summary",
    newSheetState: "New sheet",
    unsavedChanges: "Unsaved changes",
    unsavedShort: "Unsaved",
    savedState: "Saved",
    discardChanges: "Discard changes",
    discardShort: "Discard",
    discardDraftDesc: "All unsaved changes to this Daily Sheet will be discarded.",
    discardChangesBtn: "Discard Changes",
    saveSheet: "Save Sheet",
    saveSheetShort: "Save",
    confirmSaveTitle: "Save this Daily Sheet?",
    confirmSaveDesc: "Review this day's revenue and Cost Lines before saving.",
    confirmSaveBtn: "Confirm & Save",
    confirmDeleteCostLineTitle: "Delete this Cost Line?",
    confirmDeleteCostLineDesc: "This Cost Line will be removed from this day's total.",
    confirmDeleteItemTitle: "Delete this Operating Expense?",
    confirmDeleteItemDesc: "This amount will be removed from this month's total.",
    removesRecordSingle: "removes 1 record",
    removesRecordPlural: "removes {count} records",
    confirmDeleteBtn: "Delete",
    deleting: "Deleting...",
    deleteSheetBtn: "Delete Daily Sheet",
    confirmDeleteSheetTitle: "Delete this Daily Sheet?",
    confirmDeleteSheetDesc: "This removes the whole day's record, including all its Cost Lines. It cannot be undone. Any unsaved edits on screen will be discarded.",
    discardUnsavedTitle: "Discard unsaved changes?",
    discardUnsavedDesc: "This Daily Sheet has unsaved edits. Leaving this sheet will discard them.",
    discardUnsavedExpenseDesc: "This Operating Expense draft has unsaved entries. Leaving this page will discard them.",
    discardUnsavedExpenseMonthDesc: "This Operating Expense draft has unsaved entries. Switching months will discard them.",
    discardUnsavedCloseDesc: "This Month Close form has unsaved entries. Leaving this page will discard them.",
    discardUnsavedCloseMonthDesc: "This Month Close form has unsaved entries. Switching months will discard them.",
    keepEditingBtn: "Keep Editing",
    discardAndSwitchBtn: "Discard & Leave",
    discardAndSwitchMonthBtn: "Discard & Switch",
    sheetDate: "Date",
    savedTotalRevenue: "Saved Total Revenue",
    savedTotalCosts: "Saved Daily Costs",
    deleteSheetSuccess: "Daily Sheet deleted",
    sheetChangedError: "This day's record was changed elsewhere, so nothing was deleted. Please review it again.",
    saving: "Saving...",
    saveSuccess: "Daily Sheet saved successfully",
    saveError: "Failed to save, please retry",
    loadError: "Failed to load data. Please refresh or try again later.",
    retry: "Retry",
    unauthorizedError: "Unauthorized or session expired. Please sign in again.",
    forbiddenError: "Forbidden: You do not have permission to perform this action.",
    monthClosedError: "This month is closed and locked from changes.",
    networkError: "Network connection error. Please try again later.",
    outcomeUnknownError: "Not sure it saved. Press save again; it won't be counted twice.",
    invalidAmount: "Please enter a valid amount",
    otherNoteRequired: "Note is required when category is 'Other'",
    // Dashboard
    overviewTitle: "Monthly Overview",
    monthTiles: "Month Tiles",
    currentViewing: "Viewing",
    noMonthsRecorded: "No recorded months yet",
    monthSummary: "Monthly Summary",
    openStatus: "Not Closed",
    closedStatus: "Closed",
    reopenedStatus: "Reopened",
    grossProfitFormula: "Gross Profit (Revenue \u2212 Daily Costs)",
    operatingExpenses: "Operating Expenses",
    netProfit: "Net Profit",
    netProfitFormula: "Gross Profit \u2212 Operating Expenses",
    profitMargin: "Net Margin",
    shortfallLabel: "Shortfall",
    dailyCostsCoveredLabel: "Daily Costs (within revenue)",
    opexCoveredLabel: "Operating Expenses (covered)",
    shortfallUncoveredLabel: "Uncovered",
    revenueMarkLabel: "Revenue",
    shortfallSummaryCaption: "Total costs {outflow} vs {revenue} revenue",
    shortfallZeroRevenueCaption: "Total costs {outflow} with no revenue recorded",
    chartKeyRecordedZero: "RM 0 recorded",
    chartKeyUnrecorded: "No sheet",
    chartMetricTabsLabel: "Daily chart views",
    chartKeyboardHint: "Use Left and Right arrows to inspect days, Enter to pin, Escape to close",
    chartEarlierDays: "Earlier days",
    chartLaterDays: "Later days",
    vsPrevMonth: "vs",
    profitFlowTitle: "Profit Breakdown",
    insightEmpty: "No Daily Sheets recorded for this month yet.",
    insightDaysAndTopCost: "{days} sheets logged · {category} is {pct}% of Daily\u00A0Costs",
    insightDaysOnly: "{days} Daily Sheets recorded this month",
    insightLossCallout: "Total costs exceed revenue by {loss}",
    dailyAverage: "Logged-day avg",
    peakDay: "Peak day",
    prevRecordedDay: "Previous recorded day",
    nextRecordedDay: "Next recorded day",
    revenueSplit: "Cash vs TnG Revenue",
    revenueSplitSub: "Revenue share by payment channel",
    noRevenueData: "No revenue data for this month",
    costDistribution: "Cost Categories",
    costDistributionSub: "Daily Costs ranked by category",
    noCostData: "No Daily Costs for this month",
    dailyTrend: "Daily Revenue",
    dailyCostTrend: "Daily Costs",
    dailySheetsList: "Daily Sheets",
    noDailyEntries: "No Daily Sheets for this month",
    dateCol: "Date",
    daysUnit: "days",
    sheetRevCol: "Revenue",
    sheetCostCol: "Daily Costs",
    sheetProfitCol: "Gross Profit",
    // Expenses
    expensesTitle: "Operating Expenses",
    expensesListTitle: "This Month's Items",
    catRental: "Stall Rent",
    catUtilities: "Utilities",
    catWages: "Monthly Wages",
    catOpOther: "Other",
    addExpense: "Add Operating Expense",
    addExpenseSuccess: "Operating Expense added successfully",
    lastAddSaved: "Last add was saved",
    lastAddNotSaved: "Last add not saved, add again",
    deleteExpenseSuccess: "Operating Expense deleted",
    noExpensesRecorded: "No Operating Expenses recorded for this month",
    expenseTotal: "Total Operating Expenses",
    expensesThisMonthLabel: "This month",
    itemUnitSingular: "item",
    itemsUnit: "items",
    grossProfitShareLabel: "Share of Gross Profit",
    opexShareSentence: "Share of Gross Profit",
    expensesOverrunCaption: "Exceeds Gross Profit by {overrun}",
    expensesUncoveredCaption: "Uncovered by Gross Profit: {amount}",
    grossProfitBoundaryLabel: "Gross Profit",
    monthSelect: "Month",
    // Month Close
    closeTitle: "Month Close",
    bookSummaryTitle: "Book Summary",
    reconciliationSection: "Reconciliation",
    closeWarning: "Month Close locks this month from further edits.",
    cashOnHand: "Cash on Hand",
    tngOnHand: "TnG on Hand",
    expectedNet: "Book Net Profit",
    actualTotal: "Total Counted",
    reconciliationDiff: "Reconciliation Variance",
    reconciliationAwaiting: "Awaiting Count",
    reconciliationAwaitingHint: "Enter Cash on Hand or TnG balance to check variance (blank counts as RM 0.00)",
    blankCountsZeroHint: "Blank field counts as RM 0.00",
    closeReadyAwaitingHint: "Enter Cash on Hand or TnG balance before Month Close (blank counts as RM 0.00)",
    reconciliationBalanced: "Matched",
    reconciliationMismatch: "Variance Detected",
    reconciliationShortBy: "Short by",
    reconciliationOverBy: "Over by",
    closeNote: "Close Note",
    closeNoteOptional: "Close note (optional)",
    closeNotePlaceholder: "Explain the variance before Month Close",
    closeNoteExample: "e.g. spare change difference, cash shortage, or petty cash",
    confirmEmptyMonth: "No sheets, confirm Month Close for empty month",
    emptyMonthError: "No Daily Sheets recorded. Confirm empty month to proceed.",
    varianceNoteRequired: "Variance detected. A note is required.",
    reopenReasonRequired: "Reason is required to reopen this month.",
    cancel: "Cancel",
    closeLabel: "Close",
    btnPerformClose: "Close Month",
    closingMonth: "Locking month...",
    closeSuccess: "Month Close complete — ledger is now locked",
    reopenTitle: "Reopen Month (Admin Only)",
    reopenReason: "Reopen Reason",
    reopenPlaceholder: "Explain why this month must be reopened",
    btnPerformReopen: "Confirm Reopen",
    reopening: "Reopening...",
    reopenSuccess: "Month reopened successfully, editing permitted",
    closeSavedStatusStale: "Month closed. This page hasn't caught up yet.",
    reopenSavedStatusStale: "Month reopened. This page hasn't caught up yet.",
    refreshingStatus: "Refreshing…",
    closeSavedUpdating: "Month closed. Updating this page…",
    reopenSavedUpdating: "Month reopened. Updating this page…",
    refreshStillFailing: "Still couldn't refresh. Try again, or reload the page.",
    closedAtLabel: "Closed At",
    reopenedAtLabel: "Reopened At",
    reasonLabel: "Reason",
    // Settings
    settingsTitle: "Settings",
    closeSettings: "Close Settings",
    settingsSubtitle: "Manage appearance, display language, and account",
    appearanceTitle: "Appearance",
    appearanceDesc: "Bright Mode is the default for clear reading at the stall",
    themeLight: "Bright Mode",
    themeLightDesc: "Warm, clear light mode for daytime use",
    themeDark: "Dark Mode",
    themeDarkDesc: "Low-glare charcoal surface for evening review",
    languageTitle: "Language",
    languageDesc: "Switch interface language immediately",
    langZh: "简体中文",
    langZhDesc: "Simplified Chinese",
    langEn: "English",
    langEnDesc: "English interface",
    accountTitle: "Account & Session",
    accountRoleLabel: "Role",
    ledgerInfoTitle: "Ledger Details",
    ledgerCurrencyLabel: "Currency",
    ledgerTimezoneLabel: "Timezone",
    reconciliationChannelsLabel: "Channels",
    reconciliationChannelsValue: "Cash & TnG",
    signOutDesc: "Sign out of Bokli on this device",
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

function toHtmlLang(lang: Language): string {
  return lang === "zh" ? "zh-Hans" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("zh");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("bokli_lang");
      if (stored === "zh" || stored === "en") {
        setLangState(stored);
        document.documentElement.lang = toHtmlLang(stored);
      } else {
        document.documentElement.lang = "zh-Hans";
      }
    } catch {
      // localStorage unavailable (SSR/incognito)
    }
  }, []);

  const setLang = (nextLang: Language) => {
    setLangState(nextLang);
    if (typeof document !== "undefined") {
      document.documentElement.lang = toHtmlLang(nextLang);
    }
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

export interface ApiErrorPayload {
  error?: string | null;
  code?: string | null;
}

export function apiErrorPayloadFrom(err: unknown): ApiErrorPayload {
  const { message, code } = err as { message?: string; code?: string | null };
  return { error: message, code };
}

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
