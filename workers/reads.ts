import { sql } from "drizzle-orm";
import { createD1Adapter,runD1SqlBatch } from "./d1";
import { getTodayInKualaLumpur } from "../src/lib/datetime";
import { isValidDateStr, isValidMonthStr, sumSen, subSen, computeProfit, evaluateReconciliation } from "../src/lib/money";
import { resolveActiveMonthView } from "../src/lib/months";
import { COST_CATEGORIES, type CostCategory } from "../src/lib/vocab";
import type { CloudReads } from "../src/lib/cloud-contract";
import { ApiError } from "./auth";
type Db = ReturnType<typeof createD1Adapter>;

/** SQL INTEGERs cross the D1/JS boundary as decimal text, never rounded numbers. */
function sen(value: string): bigint {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw new ApiError(503,"invalidRecord");
  return sumSen([BigInt(value)]);
}
function id(value: string): number {
  const result = Number(sen(value));
  if (result <= 0) throw new ApiError(503,"invalidRecord");
  return result;
}
export async function readDailySheet(db: Db, requestedDate?: string): Promise<CloudReads["sheets"]> {
  const todayKl = getTodayInKualaLumpur();
  const date = requestedDate && isValidDateStr(requestedDate) && requestedDate <= todayKl ? requestedDate : todayKl;
  const rows = await db.all<{id:string|null;date:string;cashSen:string;tngSen:string;note:string|null;createdAt:string;updatedAt:string;isClosed:number;
    lineId:string|null;lineSheetId:string;lineAmount:string;lineCategory:string;lineNote:string|null;lineCreatedAt:string}>(sql`
    SELECT CAST(s.id AS TEXT) AS id,s.date,CAST(s.cash_sen AS TEXT) AS cashSen,CAST(s.tng_sen AS TEXT) AS tngSen,
      s.note,s.created_at AS createdAt,s.updated_at AS updatedAt,
      CASE WHEN c.id IS NOT NULL AND (c.reopened_at IS NULL OR c.reopened_at='') THEN 1 ELSE 0 END AS isClosed,
      CAST(l.id AS TEXT) AS lineId,CAST(l.daily_sheet_id AS TEXT) AS lineSheetId,CAST(l.amount_sen AS TEXT) AS lineAmount,
      l.category AS lineCategory,l.note AS lineNote,l.created_at AS lineCreatedAt
    FROM (SELECT ${date} AS date) target LEFT JOIN daily_sheets s ON s.date=target.date
    LEFT JOIN month_closes c ON c.month=substr(target.date,1,7)
    LEFT JOIN cost_lines l ON l.daily_sheet_id=s.id ORDER BY l.id`);
  const [row] = rows;
  const isClosed = Boolean(row.isClosed);
  if (row.id === null) return {date,todayKl,isClosed,data:null};
  const sheet = {id:id(row.id),date:row.date,cashSen:Number(sen(row.cashSen)),tngSen:Number(sen(row.tngSen)),note:row.note,createdAt:row.createdAt,updatedAt:row.updatedAt};
  const costLines = rows.filter(r=>r.lineId!==null).map(r=>({id:id(r.lineId!),dailySheetId:id(r.lineSheetId),amountSen:Number(sen(r.lineAmount)),
    category:r.lineCategory,note:r.lineNote,createdAt:r.lineCreatedAt}));
  const totalCostSen = sumSen(costLines.map(r=>BigInt(r.amountSen)));
  const totalRevenueSen = sumSen([BigInt(sheet.cashSen),BigInt(sheet.tngSen)]);
  const grossProfitSen = subSen(totalRevenueSen,totalCostSen);
  return {date,todayKl,isClosed,data:{sheet,costLines,totalCostSen:Number(totalCostSen),totalRevenueSen:Number(totalRevenueSen),grossProfitSen:Number(grossProfitSen)}};
}

type RawClose = { [K in keyof import("../src/db/schema").MonthClose]: NonNullable<import("../src/db/schema").MonthClose[K]> extends number ? string | Extract<import("../src/db/schema").MonthClose[K],null> : import("../src/db/schema").MonthClose[K] };
// Fixed identifiers only. Every INTEGER inside JSON is cast before D1 encodes it.
const closeJson = sql`json_object('id',CAST(c.id AS TEXT),'month',c.month,
  'revenueSen',CAST(c.revenue_sen AS TEXT),'dailyCostSen',CAST(c.daily_cost_sen AS TEXT),
  'grossSen',CAST(c.gross_sen AS TEXT),'operatingSen',CAST(c.operating_sen AS TEXT),'netSen',CAST(c.net_sen AS TEXT),
  'cashOnHandSen',CAST(c.cash_on_hand_sen AS TEXT),'tngOnHandSen',CAST(c.tng_on_hand_sen AS TEXT),
  'note',c.note,'closedAt',c.closed_at,'reopenedAt',c.reopened_at,'reopenReason',c.reopen_reason)`;

function closeRecord(raw: RawClose): import("../src/lib/cloud-contract").Wire<import("../src/services/month-close").MonthCloseWithReconciliation> {
  const row = {...raw,id:id(raw.id),
    revenueSen:Number(sen(raw.revenueSen)),dailyCostSen:Number(sen(raw.dailyCostSen)),grossSen:Number(sen(raw.grossSen)),
    operatingSen:Number(sen(raw.operatingSen)),netSen:Number(sen(raw.netSen)),
    cashOnHandSen:raw.cashOnHandSen===null?null:Number(sen(raw.cashOnHandSen)),tngOnHandSen:raw.tngOnHandSen===null?null:Number(sen(raw.tngOnHandSen))};
  const reconciliation = evaluateReconciliation({expectedSen:BigInt(row.netSen),cashOnHandSen:BigInt(row.cashOnHandSen??0),tngOnHandSen:BigInt(row.tngOnHandSen??0)});
  return {...row,...wire(reconciliation),...(reconciliation.balanced?{}:{warning:`Reconciliation mismatch: expected ${reconciliation.expectedSen} sen, actual ${reconciliation.actualSen} sen (difference: ${reconciliation.differenceSen} sen)`})};
}
function wire<T>(value: T): import("../src/lib/cloud-contract").Wire<T> {
  return JSON.parse(JSON.stringify(value,(_,v)=>typeof v === "bigint"?Number(sumSen([v])):v));
}
interface MonthRow { month:string;cash:string;tng:string;cost:string;operating:string;sheetCount:number;closeJson:string|null }
function monthsQuery(current: string) {
  return sql`
    WITH sheets AS (SELECT substr(date,1,7) AS month,SUM(cash_sen) AS cash,SUM(tng_sen) AS tng,COUNT(*) AS sheetCount
      FROM daily_sheets WHERE substr(date,1,7)<=${current} GROUP BY substr(date,1,7)),
    costs AS (SELECT substr(s.date,1,7) AS month,SUM(l.amount_sen) AS cost FROM cost_lines l JOIN daily_sheets s ON s.id=l.daily_sheet_id
      WHERE substr(s.date,1,7)<=${current} GROUP BY substr(s.date,1,7)),
    expenses AS (SELECT month,SUM(amount_sen) AS operating FROM operating_expenses WHERE month<=${current} GROUP BY month),
    available AS (SELECT month FROM sheets UNION SELECT month FROM expenses UNION SELECT month FROM month_closes WHERE month<=${current})
    SELECT a.month,COALESCE(CAST(s.cash AS TEXT),'0') AS cash,COALESCE(CAST(s.tng AS TEXT),'0') AS tng,
      COALESCE(CAST(k.cost AS TEXT),'0') AS cost,COALESCE(CAST(e.operating AS TEXT),'0') AS operating,
      COALESCE(s.sheetCount,0) AS sheetCount,CASE WHEN c.id IS NULL THEN NULL ELSE ${closeJson} END AS closeJson
    FROM available a LEFT JOIN sheets s ON s.month=a.month LEFT JOIN costs k ON k.month=a.month
      LEFT JOIN expenses e ON e.month=a.month LEFT JOIN month_closes c ON c.month=a.month ORDER BY a.month DESC`;
}
function months(rows: MonthRow[]) {
  return rows.map(row=> {
    const cashSen=sen(row.cash),tngSen=sen(row.tng),revenueSen=sumSen([cashSen,tngSen]),dailyCostSen=sen(row.cost),operatingSen=sen(row.operating);
    const preview={month:row.month,revenueSen,dailyCostSen,operatingSen,...computeProfit({revenueSen,dailyCostSen,operatingSen})};
    const close=row.closeJson===null?null:closeRecord(JSON.parse(row.closeJson) as RawClose);
    const closed=close!==null&&!close.reopenedAt;
    const tile: import("../src/services/dashboard").MonthTile=closed?{
      month:row.month,revenueSen:BigInt(close.revenueSen),dailyCostSen:BigInt(close.dailyCostSen),grossSen:BigInt(close.grossSen),
      operatingSen:BigInt(close.operatingSen),netSen:BigInt(close.netSen),status:"closed",balanced:close.balanced,
    }:{...preview,status:close?.reopenedAt?"reopened":"open"};
    return {row,tile,preview,close,cashSen,tngSen};
  });
}

export async function readMonthPage(db: Db, page: "dashboard"|"expenses"|"close", identity: import("./auth").CloudIdentity, requestedMonth?: string): Promise<CloudReads[typeof page]> {
  const current = getTodayInKualaLumpur().slice(0,7);
  // Match resolveActiveMonthView inside the same read transaction, before JS consumes its rows.
  const active = requestedMonth && isValidMonthStr(requestedMonth) ? sql`${requestedMonth>current?current:requestedMonth}` : sql`
    COALESCE((SELECT MAX(month) FROM (
      SELECT MAX(substr(date,1,7)) AS month FROM daily_sheets WHERE substr(date,1,7)<=${current}
      UNION ALL SELECT MAX(month) FROM operating_expenses WHERE month<=${current}
      UNION ALL SELECT MAX(month) FROM month_closes WHERE month<=${current})),${current})`;
  const queries = [monthsQuery(current)];
  if (page==="expenses") queries.push(sql`
    SELECT CAST(id AS TEXT) AS id,month,type,CAST(amount_sen AS TEXT) AS amountSen,note,created_at AS createdAt,updated_at AS updatedAt
    FROM operating_expenses WHERE month=${active} ORDER BY operating_expenses.id`);
  if (page==="dashboard") queries.push(sql`
    SELECT s.date,CAST(s.cash_sen AS TEXT) AS cash,CAST(s.tng_sen AS TEXT) AS tng,
      COALESCE(CAST(SUM(l.amount_sen) AS TEXT),'0') AS cost FROM daily_sheets s LEFT JOIN cost_lines l ON l.daily_sheet_id=s.id
    WHERE s.date LIKE (${active} || '-%') GROUP BY s.id ORDER BY s.date`,sql`
    SELECT l.category,CAST(SUM(l.amount_sen) AS TEXT) AS amount FROM cost_lines l JOIN daily_sheets s ON s.id=l.daily_sheet_id
    WHERE s.date LIKE (${active} || '-%') GROUP BY l.category`);
  const results = await runD1SqlBatch(db,queries);
  const recorded=months(results[0].results as MonthRow[]);
  const tiles=recorded.map(r=>r.tile);
  const view=resolveActiveMonthView(requestedMonth,tiles,current);
  const month=view.activeMonth;
  const selected=recorded.find(r=>r.row.month===month);
  const preview=selected?.preview??{month,revenueSen:0n,dailyCostSen:0n,grossSen:0n,operatingSen:0n,netSen:0n};
  const tile=selected?.tile??{...preview,status:"open" as const};
  if (page==="close") return {...view,financials:wire(preview),closeRecord:selected?.close??null,hasSheetsInMonth:(selected?.row.sheetCount??0)>0,userRole:identity.role};
  if (page==="expenses") {
    const rows=results[1].results as {id:string;month:string;type:string;amountSen:string;note:string|null;createdAt:string;updatedAt:string}[];
    return {...view,expenses:rows.map(r=>({...r,id:id(r.id),amountSen:Number(sen(r.amountSen))})),summary:wire(preview),isClosed:tile.status==="closed"};
  }
  const trendRows=results[1].results as {date:string;cash:string;tng:string;cost:string}[];
  const trend=trendRows.map(r=>({date:r.date,cashSen:sen(r.cash),tngSen:sen(r.tng),totalSen:sumSen([sen(r.cash),sen(r.tng)]),costSen:sen(r.cost)}));
  const categoryRows=results[2].results as {category:CostCategory;amount:string}[];
  const costByCategory=Object.fromEntries(COST_CATEGORIES.map(c=>[c,0n])) as Record<CostCategory,bigint>;
  for(const row of categoryRows) costByCategory[row.category]=sen(row.amount);
  const cashSen=selected?.cashSen??0n,tngSen=selected?.tngSen??0n;
  return wire({activeMonth:month,tiles:selected?tiles:[tile,...tiles],tile,trend,split:{cashSen,tngSen,totalSen:sumSen([cashSen,tngSen])},costByCategory});
}
export async function readHistory(db: Db): Promise<CloudReads["history"]> {
  const rows=await db.all<{closeJson:string}>(sql`SELECT ${closeJson} AS closeJson FROM month_closes c ORDER BY c.month DESC`);
  return rows.map(row=>{
    const {warning: _warning,...close}=closeRecord(JSON.parse(row.closeJson) as RawClose);
    void _warning;
    return close;
  });
}
