import Link from "next/link";
import { formatMyr } from "@/lib/money";
import {
  getCashTngSplit,
  getCostByCategory,
  getDailyTrend,
  getMonthTile,
  listMonthTiles,
  type CostByCategory,
  type DailyTrendRow,
  type MonthTile,
} from "@/services/dashboard";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

const CATEGORY_NAMES: Record<string, { zh: string; en: string }> = {
  restock: { zh: "进货", en: "Restock" },
  gas: { zh: "煤气", en: "Gas" },
  transport: { zh: "交通", en: "Transport" },
  "wages-daily": { zh: "每日工资", en: "Daily Wages" },
  other: { zh: "其他", en: "Other" },
};

export default async function DashboardPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const requestedMonth =
    typeof searchParams?.month === "string" ? searchParams.month : undefined;

  const tiles = await listMonthTiles();
  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);

  // Active month: requested month, or first existing month tile, or current month
  const activeMonth =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : tiles.length > 0
        ? tiles[0].month
        : currentMonthInKL;

  let activeTile: MonthTile | null = null;
  let trend: DailyTrendRow[] = [];
  let split = { cashSen: 0n, tngSen: 0n, totalSen: 0n };
  let costByCategory: CostByCategory = {
    restock: 0n,
    gas: 0n,
    transport: 0n,
    "wages-daily": 0n,
    other: 0n,
  };

  try {
    [activeTile, trend, split, costByCategory] = await Promise.all([
      getMonthTile(activeMonth),
      getDailyTrend(activeMonth),
      getCashTngSplit(activeMonth),
      getCostByCategory(activeMonth),
    ]);
  } catch {
    // If month data cannot be loaded, fallback to null
  }

  // Calculate percentages for visual bars (display only)
  const totalRev = split.totalSen;
  const cashPct =
    totalRev > 0n ? Number((split.cashSen * 100n) / totalRev) : 0;
  const tngPct = totalRev > 0n ? 100 - cashPct : 0;

  const totalCost =
    costByCategory.restock +
    costByCategory.gas +
    costByCategory.transport +
    costByCategory["wages-daily"] +
    costByCategory.other;

  return (
    <main
      style={{
        maxWidth: "768px",
        margin: "0 auto",
        padding: "16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1f2937",
        backgroundColor: "#f9fafb",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <header
        style={{
          marginBottom: "20px",
          paddingBottom: "12px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 800,
            margin: "0 0 4px 0",
            color: "#111827",
          }}
        >
          经营概览 (Business Overview)
        </h1>
        <p style={{ margin: 0, fontSize: "14px", color: "#6b7280" }}>
          家庭摊位记账看板 (Food stall health &amp; metrics)
        </p>
      </header>

      {/* Month Tiles Navigation (Recent Months) */}
      <section style={{ marginBottom: "24px" }} aria-label="Month tiles">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>
            月份卡片 (Month Tiles)
          </h2>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>
            当前查看: {activeMonth}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            overflowX: "auto",
            paddingBottom: "8px",
          }}
        >
          {tiles.length === 0 ? (
            <div
              style={{
                padding: "16px",
                background: "#fff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                width: "100%",
                textAlign: "center",
                color: "#6b7280",
                fontSize: "14px",
              }}
            >
              暂无历史月份记录 (No closed or recorded months yet)
            </div>
          ) : (
            tiles.map((t) => {
              const isSelected = t.month === activeMonth;
              return (
                <Link
                  key={t.month}
                  href={`/dashboard?month=${t.month}`}
                  style={{
                    display: "block",
                    minWidth: "150px",
                    minHeight: "48px",
                    padding: "12px",
                    borderRadius: "12px",
                    textDecoration: "none",
                    color: "inherit",
                    backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                    border: isSelected ? "2px solid #2563eb" : "1px solid #d1d5db",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px",
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: "15px" }}>
                      {t.month}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "6px",
                        backgroundColor:
                          t.status === "closed"
                            ? "#dcfce7"
                            : t.status === "reopened"
                              ? "#fef9c3"
                              : "#e0f2fe",
                        color:
                          t.status === "closed"
                            ? "#166534"
                            : t.status === "reopened"
                              ? "#854d0e"
                              : "#075985",
                      }}
                    >
                      {t.status === "closed"
                        ? "已结账"
                        : t.status === "reopened"
                          ? "已重开"
                          : "进行中"}
                    </span>
                  </div>

                  <div style={{ fontSize: "12px", color: "#4b5563" }}>
                    净利润:{" "}
                    <strong
                      style={{
                        color: t.netSen >= 0n ? "#16a34a" : "#dc2626",
                        fontSize: "13px",
                      }}
                    >
                      {formatMyr(t.netSen)}
                    </strong>
                  </div>

                  {t.status === "closed" && (
                    <div
                      style={{
                        marginTop: "4px",
                        fontSize: "11px",
                        color: t.balanced ? "#16a34a" : "#dc2626",
                        fontWeight: 600,
                      }}
                    >
                      {t.balanced ? "✓ 对账平衡" : "⚠ 对账有差异"}
                    </div>
                  )}
                </Link>
              );
            })
          )}
        </div>
      </section>

      {/* Active Month Overview Cards */}
      {activeTile && (
        <section
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            padding: "16px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            marginBottom: "20px",
          }}
          aria-label="Active month metrics"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
              paddingBottom: "8px",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <div>
              <span
                style={{ fontSize: "13px", color: "#6b7280", fontWeight: 500 }}
              >
                月度概况 (Month Tile)
              </span>
              <div style={{ fontSize: "20px", fontWeight: 800 }}>
                {activeMonth}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  backgroundColor:
                    activeTile.status === "closed"
                      ? "#dcfce7"
                      : activeTile.status === "reopened"
                        ? "#fef9c3"
                        : "#e0f2fe",
                  color:
                    activeTile.status === "closed"
                      ? "#166534"
                      : activeTile.status === "reopened"
                        ? "#854d0e"
                        : "#075985",
                }}
              >
                {activeTile.status === "closed"
                  ? "已结账 (Closed)"
                  : activeTile.status === "reopened"
                    ? "已重开 (Reopened)"
                    : "进行中 (Open)"}
              </span>
              {activeTile.status === "closed" && (
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    marginTop: "2px",
                    color: activeTile.balanced ? "#16a34a" : "#dc2626",
                  }}
                >
                  {activeTile.balanced
                    ? "对账平衡 (Balanced)"
                    : "对账不平 (Mismatch)"}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "12px",
            }}
          >
            <div
              style={{
                backgroundColor: "#f9fafb",
                padding: "12px",
                borderRadius: "10px",
              }}
            >
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                总营业收入 (Revenue)
              </div>
              <div
                style={{ fontSize: "17px", fontWeight: 800, color: "#111827" }}
              >
                {formatMyr(activeTile.revenueSen)}
              </div>
            </div>

            <div
              style={{
                backgroundColor: "#f9fafb",
                padding: "12px",
                borderRadius: "10px",
              }}
            >
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                日常开销 (Daily Costs)
              </div>
              <div
                style={{ fontSize: "17px", fontWeight: 800, color: "#dc2626" }}
              >
                {formatMyr(activeTile.dailyCostSen)}
              </div>
            </div>

            <div
              style={{
                backgroundColor: "#f9fafb",
                padding: "12px",
                borderRadius: "10px",
              }}
            >
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                毛利润 (Gross Profit)
              </div>
              <div
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  color: activeTile.grossSen >= 0n ? "#16a34a" : "#dc2626",
                }}
              >
                {formatMyr(activeTile.grossSen)}
              </div>
            </div>

            <div
              style={{
                backgroundColor: "#f9fafb",
                padding: "12px",
                borderRadius: "10px",
              }}
            >
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                固定运营支出 (Operating)
              </div>
              <div
                style={{ fontSize: "17px", fontWeight: 800, color: "#dc2626" }}
              >
                {formatMyr(activeTile.operatingSen)}
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor:
                activeTile.netSen >= 0n ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${activeTile.netSen >= 0n ? "#bbf7d0" : "#fecaca"}`,
              padding: "14px",
              borderRadius: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: activeTile.netSen >= 0n ? "#166534" : "#991b1b",
                }}
              >
                本月净利润 (Net Profit)
              </div>
              <div style={{ fontSize: "11px", color: "#6b7280" }}>
                毛利润 - 固定支出
              </div>
            </div>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 900,
                color: activeTile.netSen >= 0n ? "#15803d" : "#b91c1c",
              }}
            >
              {formatMyr(activeTile.netSen)}
            </div>
          </div>
        </section>
      )}

      {/* Cash vs TnG Split (现金与 TnG 分布) */}
      <section
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "16px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: "20px",
        }}
        aria-label="Cash versus TnG split"
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 700,
            margin: "0 0 12px 0",
            color: "#111827",
          }}
        >
          收入分布 (Cash versus TnG Split)
        </h2>

        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              height: "24px",
              borderRadius: "12px",
              backgroundColor: "#e5e7eb",
              display: "flex",
              overflow: "hidden",
            }}
          >
            {split.totalSen > 0n ? (
              <>
                <div
                  style={{
                    width: `${cashPct}%`,
                    backgroundColor: "#10b981",
                    transition: "width 0.3s ease",
                  }}
                  title={`现金: ${cashPct}%`}
                />
                <div
                  style={{
                    width: `${tngPct}%`,
                    backgroundColor: "#3b82f6",
                    transition: "width 0.3s ease",
                  }}
                  title={`TnG: ${tngPct}%`}
                />
              </>
            ) : (
              <div
                style={{
                  width: "100%",
                  textAlign: "center",
                  fontSize: "11px",
                  color: "#9ca3af",
                  lineHeight: "24px",
                }}
              >
                暂无收入数据
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              borderLeft: "4px solid #10b981",
              backgroundColor: "#f9fafb",
            }}
          >
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              现金收入 (Cash Revenue)
            </div>
            <div
              style={{ fontSize: "16px", fontWeight: 800, color: "#111827" }}
            >
              {formatMyr(split.cashSen)}
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280" }}>
              占比: {cashPct}%
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              borderLeft: "4px solid #3b82f6",
              backgroundColor: "#f9fafb",
            }}
          >
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              TnG 收入 (TnG Revenue)
            </div>
            <div
              style={{ fontSize: "16px", fontWeight: 800, color: "#111827" }}
            >
              {formatMyr(split.tngSen)}
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280" }}>
              占比: {tngPct}%
            </div>
          </div>
        </div>
      </section>

      {/* Cost by Cost Category (日常开销分类) */}
      <section
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "16px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: "20px",
        }}
        aria-label="Cost by Cost Category"
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 700,
            margin: "0 0 12px 0",
            color: "#111827",
          }}
        >
          开销分类 (Cost by Cost Category)
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Object.entries(costByCategory).map(([catKey, amountSen]) => {
            const catInfo = CATEGORY_NAMES[catKey] ?? {
              zh: catKey,
              en: catKey,
            };
            const pct =
              totalCost > 0n ? Number((amountSen * 100n) / totalCost) : 0;

            return (
              <div key={catKey}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "13px",
                    marginBottom: "4px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {catInfo.zh} ({catInfo.en})
                  </span>
                  <span>
                    <strong>{formatMyr(amountSen)}</strong>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#6b7280",
                        marginLeft: "6px",
                      }}
                    >
                      ({pct}%)
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    height: "8px",
                    borderRadius: "4px",
                    backgroundColor: "#f3f4f6",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      backgroundColor: "#f59e0b",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Daily Revenue Trend (每日走势) */}
      <section
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "16px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: "24px",
        }}
        aria-label="Daily revenue trend"
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 700,
            margin: "0 0 12px 0",
            color: "#111827",
          }}
        >
          每日走势 (Daily Revenue Trend)
        </h2>

        {trend.length === 0 ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: "14px",
            }}
          >
            本月暂无 Daily Sheet 记录 (No Daily Sheets logged for this month)
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {trend.map((row) => (
              <div
                key={row.date}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "8px",
                  fontSize: "13px",
                  minHeight: "48px",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: "#111827" }}>
                    {row.date}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280" }}>
                    现金: {formatMyr(row.cashSen)} | TnG:{" "}
                    {formatMyr(row.tngSen)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 800,
                      color: "#16a34a",
                    }}
                  >
                    {formatMyr(row.totalSen)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
