import { sql, type SQL } from "drizzle-orm";
import { createD1Adapter,runD1SqlBatch } from "./d1";
import { ApiError, normalizeEmail, type CloudIdentity, type WorkerEnv } from "./auth";
import { getTodayInKualaLumpur } from "../src/lib/datetime";
import { isValidDateStr, isValidMonthStr, sumSen, subSen, computeProfit, evaluateReconciliation } from "../src/lib/money";
import { COST_CATEGORIES, OPERATING_EXPENSE_TYPES } from "../src/lib/vocab";
import { groupCostLines, CostLineAmountOverflowError } from "../src/lib/cost-line-group";
import { parseJsonBody, parsePositiveId } from "../src/lib/parse";

type Db = ReturnType<typeof createD1Adapter>;
export type Operation = import("../src/lib/cloud-contract").CloudOperation;
const MAX = Number.MAX_SAFE_INTEGER;
export class WriteError extends ApiError {
  constructor(status: number, code: string, readonly error: string) { super(status, code); }
}
function invalid(error: string, code = "saveError"): never { throw new WriteError(400, code, error); }
function amount(value: unknown): number {
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid("Amount must be a non-negative safe integer (sen)", "invalidAmount");
  return value;
}
function note(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid("Note must be a string");
  return value.trim() || null;
}
export function operationId(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 200) invalid("Idempotency key must be a string of 1 to 200 characters");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !isValidDateStr(value)) invalid("Invalid date format, expected YYYY-MM-DD");
  if (value > getTodayInKualaLumpur()) invalid("Date is in the future", "futureDate");
  return value;
}
function month(value: unknown, futureCode = "futureDate"): string {
  if (typeof value !== "string" || !isValidMonthStr(value)) invalid("Invalid month format, expected YYYY-MM");
  if (value > getTodayInKualaLumpur().slice(0,7)) invalid("Month is in the future", futureCode);
  return value;
}
interface Receipt { payload: string; result: string | null; status: number | null; attemptToken: string }
function receiptQuery(identity: CloudIdentity, operation: Operation, key: string): SQL {
  return sql`SELECT payload,result,status,attempt_token AS attemptToken FROM cloud_operation_receipts
    WHERE actor_user_id=${identity.id} AND operation=${operation} AND operation_id=${key}`;
}
function result(receipt: Receipt, payload: string, attempt: string) {
  if (receipt.payload !== payload) throw new WriteError(409,"operationConflict","Operation ID was already used for a different payload");
  if (receipt.result === null || receipt.status === null) throw new WriteError(503,"outcomeUnknown","Resolve this operation through authenticated status before retrying");
  return { body: JSON.parse(receipt.result), status: receipt.status, replayed: receipt.attemptToken !== attempt };
}
function expenseReplay(body: Extract<import("../src/lib/cloud-contract").CloudMutation,{path:"/api/cloud-v1/expenses";method:"POST"}>["result"]) {
  return { ...body, alreadySaved:true, expense:{...body.expense,alreadySaved:true} };
}
function legacyResult(value: string) {
  const e = JSON.parse(value);
  if (!["rental","utilities","wages","other"].includes(e.type) || !isValidMonthStr(e.month) ||
    ![e.id,e.amountSen].every(Number.isSafeInteger) || e.id <= 0 || e.amountSen < 0 ||
    (e.note !== null && typeof e.note !== "string") || typeof e.createdAt !== "string" || typeof e.updatedAt !== "string" || typeof e.merged !== "boolean")
    throw new WriteError(503,"invalidRecord","Historical receipt needs verification");
  const expense = {id:e.id,month:e.month,type:e.type,amountSen:e.amountSen,note:e.note,createdAt:e.createdAt,updatedAt:e.updatedAt,merged:e.merged,alreadySaved:true};
  return {expense,merged:expense.merged,alreadySaved:true};
}
async function legacyReceipt(db: Db, key: string, identity?: CloudIdentity) {
  const [row] = await db.all<{owner:string|null;month:string;type:string;amount:string;note:string|null;result:string}>(sql`
    SELECT CAST(o.actor_user_id AS TEXT) AS owner,r.month,r.type,CAST(r.amount_sen AS TEXT) AS amount,r.note,r.result
    FROM operating_expense_add_requests r LEFT JOIN legacy_expense_receipt_owners o ON o.idempotency_key=r.idempotency_key WHERE r.idempotency_key=${key}
    ${identity ? sql`AND NOT EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE actor_user_id=${identity.id} AND operation='expense.add' AND operation_id=${key})` : sql``}`);
  return row;
}
export async function status(env: WorkerEnv, identity: CloudIdentity, operation: Operation, key: string) {
  operationId(key);
  if (operation === "month.reopen" && identity.role !== "Admin") throw new WriteError(403,"forbidden","Admin role required");
  const db = createD1Adapter(env.BOKLI_DB.withSession("first-primary"));
  const [receipt] = await db.all<Receipt>(receiptQuery(identity,operation,key));
  if (receipt) {
    const stored = result(receipt,receipt.payload,"");
    return {saved:true,status:operation === "expense.add" ? 200 : stored.status,result:operation === "expense.add" ? expenseReplay(stored.body) : stored.body};
  }
  if (operation === "expense.add") {
    const legacy = await legacyReceipt(db,key);
    if (legacy && legacy.owner === null) throw new WriteError(409,"legacyReceiptUnscoped","Historical expense key requires explicit ownership verification");
    if (legacy?.owner === String(identity.id)) return {saved:true,status:200,result:legacyResult(legacy.result)};
  }
  return {saved:false};
}

/** All guards and response generation are statements inside the same D1 transaction. */
async function commit(db: Db, identity: CloudIdentity, email: string, operation: Operation, key: string,
  payload: string, build: (pending: SQL, guard: (condition: SQL, code: string) => SQL) => SQL[]) {
  const attempt = crypto.randomUUID();
  const scope = sql`actor_user_id=${identity.id} AND operation=${operation} AND operation_id=${key}`;
  const active = sql`EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE ${scope} AND attempt_token=${attempt})`;
  const pending = sql`EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE ${scope} AND attempt_token=${attempt} AND result IS NULL)`;
  const guard = (condition: SQL, code: string) => sql`UPDATE cloud_write_guard SET check_code=CASE WHEN ${condition} THEN ${code} ELSE NULL END WHERE id=1 AND ${active}`;
  const queries = [
    sql`INSERT INTO cloud_operation_receipts(actor_user_id,operation,operation_id,payload,attempt_token)
      SELECT ${identity.id},${operation},${key},${payload},${attempt} WHERE NOT EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE ${scope})`,
    guard(sql`maintenance=1`, "BOKLI_MAINTENANCE"),
    guard(sql`NOT EXISTS(SELECT 1 FROM users u JOIN user_emails e ON e.user_id=u.id WHERE u.id=${identity.id} AND e.email=${email}
      AND u.role=${identity.role} AND (${operation}<>'month.reopen' OR u.role='Admin'))`, "BOKLI_FORBIDDEN"),
    ...build(pending, guard),
    guard(sql`EXISTS(SELECT 1 FROM cloud_operation_receipts WHERE ${scope} AND result IS NULL)`,"BOKLI_RESULT_MISSING"),
    guard(sql`EXISTS(SELECT 1 FROM cloud_operation_receipts r,json_tree(r.result) j WHERE ${sql`r.actor_user_id=${identity.id} AND r.operation=${operation} AND r.operation_id=${key}`}
      AND j.type IN ('real','integer') AND (j.atom<>CAST(j.atom AS INTEGER) OR j.atom>${MAX} OR j.atom<${-MAX}
        OR (j.key IN ('id','dailySheetId') AND j.atom<1)))`,"BOKLI_MONEY_RANGE"),
  ];
  // The final response is read within the batch, never from a later mutable row.
  const responses = await runD1SqlBatch<Receipt>(db,[...queries,receiptQuery(identity,operation,key)]);
  const rows = responses[responses.length-1].results;
  if (operation === "expense.add" && rows[0].payload !== payload) invalid("Idempotency key was already used for a different Operating Expense");
  return result(rows[0], payload, attempt);
}

const sheetJson = sql`json_object('id',s.id,'date',s.date,'cashSen',s.cash_sen,'tngSen',s.tng_sen,'note',s.note,'createdAt',s.created_at,'updatedAt',s.updated_at)`;
const linesJson = sql`(SELECT json_group_array(json_object('id',l.id,'dailySheetId',l.daily_sheet_id,'amountSen',l.amount_sen,'category',l.category,'note',l.note,'createdAt',l.created_at))
  FROM (SELECT * FROM cost_lines WHERE daily_sheet_id=s.id ORDER BY id) l)`;
const expenseJson = sql`json_object('id',e.id,'month',e.month,'type',e.type,'amountSen',e.amount_sen,'note',e.note,'createdAt',e.created_at,'updatedAt',e.updated_at,
  'merged',json(CASE WHEN changes()=0 THEN 'true' ELSE 'false' END),'alreadySaved',json('false'))`;
const closeJson = sql`json_object('id',c.id,'month',c.month,'revenueSen',c.revenue_sen,'dailyCostSen',c.daily_cost_sen,'grossSen',c.gross_sen,
  'operatingSen',c.operating_sen,'netSen',c.net_sen,'cashOnHandSen',c.cash_on_hand_sen,'tngOnHandSen',c.tng_on_hand_sen,
  'note',c.note,'closedAt',c.closed_at,'reopenedAt',c.reopened_at,'reopenReason',c.reopen_reason)`;
function previewQuery(businessMonth: string) {
  return sql`SELECT
    (SELECT CAST(COALESCE(SUM(cash_sen),0) AS TEXT) FROM daily_sheets WHERE date LIKE ${businessMonth+"-%"}) AS cash,
    (SELECT CAST(COALESCE(SUM(tng_sen),0) AS TEXT) FROM daily_sheets WHERE date LIKE ${businessMonth+"-%"}) AS tng,
    (SELECT CAST(COALESCE(SUM(l.amount_sen),0) AS TEXT) FROM cost_lines l JOIN daily_sheets s ON s.id=l.daily_sheet_id WHERE s.date LIKE ${businessMonth+"-%"}) AS cost,
    (SELECT CAST(COALESCE(SUM(amount_sen),0) AS TEXT) FROM operating_expenses WHERE month=${businessMonth}) AS operating,
    (SELECT CAST(COUNT(*) AS TEXT) FROM daily_sheets WHERE date LIKE ${businessMonth+"-%"}) AS sheetCount`;
}
interface Preview { cash:string;tng:string;cost:string;operating:string;sheetCount:string }
const guardErrors: Record<string,[number,string]> = {
  BOKLI_MONTH_LOCKED:[409,"monthClosed"], BOKLI_MAINTENANCE:[503,"maintenance"], BOKLI_FORBIDDEN:[403,"forbidden"], BOKLI_MONEY_RANGE:[422,"moneyRange"],
  BOKLI_NOT_FOUND:[404,"notFound"], BOKLI_SHEET_CHANGED:[409,"sheetChanged"], BOKLI_LEGACY_SCOPE:[409,"legacyReceiptUnscoped"],
  BOKLI_ALREADY_OPEN:[400,"saveError"], BOKLI_STALE_CLOSE:[409,"closeChanged"], BOKLI_EMPTY_MONTH:[400,"saveError"], BOKLI_VARIANCE_NOTE:[400,"varianceNoteRequired"],
  BOKLI_RESULT_MISSING:[503,"outcomeUnknown"],
  BOKLI_EXPENSE_OVERFLOW:[400,"invalidAmount"],
};
/** Exact registered errors only: substring lookalikes remain unknown outcomes. */
export function writeGuardError(error: unknown): WriteError | undefined {
  const cause = error instanceof Error ? error.message.replace(/^D1_ERROR: /, "").replace(/: SQLITE_CONSTRAINT(?:_[A-Z]+)?$/, "") : "";
  const code = /^BOKLI_[A-Z_]+$/.test(cause) ? cause : undefined;
  const mapped = code && guardErrors[code];
  return mapped ? new WriteError(mapped[0],mapped[1],"Cloud write guard refused the operation") : undefined;
}

export async function mutate(request: Request, env: WorkerEnv, identity: CloudIdentity, emailClaim: unknown, page: string) {
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("X-Bokli-Api-Generation") !== "cloud-v1" ||
    ["cross-site","none"].includes(request.headers.get("Sec-Fetch-Site") ?? "")) throw new WriteError(403,"forbidden","Invalid mutation Origin or CSRF marker");
  // Browsers send an empty body stream with a bodyless DELETE.
  const bodylessDelete = page === "sheets" && request.method === "DELETE" && (request.body === null || await request.clone().text() === "");
  if (!bodylessDelete && request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new WriteError(415,"saveError","Content-Type must be application/json");
  const parsed = bodylessDelete ? {ok:true as const,body:{} as Record<string,unknown>} : await parseJsonBody(request);
  if (!parsed.ok) throw new WriteError(parsed.status,parsed.code,parsed.error);
  const body = parsed.body;
  const key = page === "expenses" && request.method === "POST" && !request.headers.has("Idempotency-Key") ? crypto.randomUUID() : operationId(request.headers.get("Idempotency-Key"));
  const email = normalizeEmail(emailClaim);
  const db = createD1Adapter(env.BOKLI_DB.withSession("first-primary"));
  if (page === "close/reopen" && request.method === "POST") {
    if (identity.role !== "Admin") throw new WriteError(403,"forbidden","Admin role required to reopen a closed month");
    if (url.search) invalid("Unexpected query parameters");
    if (typeof body.month !== "string" || !isValidMonthStr(body.month)) invalid("Invalid month format, expected YYYY-MM");
    const businessMonth = body.month;
    if (typeof body.reason !== "string") invalid("A reason is required to reopen a closed month","reopenReasonRequired");
    const reason = note(body.reason);
    if (!reason) invalid("A reason is required to reopen a closed month","reopenReasonRequired");
    const at = new Date().toISOString();
    return commit(db,identity,email,"month.reopen",key,JSON.stringify({month:businessMonth,reason}),(pending,guard)=>[
      guard(sql`NOT EXISTS(SELECT 1 FROM month_closes WHERE month=${businessMonth})`,"BOKLI_NOT_FOUND"),
      guard(sql`EXISTS(SELECT 1 FROM month_closes WHERE month=${businessMonth} AND reopened_at IS NOT NULL AND reopened_at<>'')`,"BOKLI_ALREADY_OPEN"),
      sql`UPDATE month_closes SET reopened_at=${at},reopen_reason=${reason} WHERE month=${businessMonth} AND ${pending}`,
      sql`INSERT INTO month_close_events(month,action,at,reason,snapshot,actor_user_id,actor_role)
        SELECT c.month,'reopen',c.reopened_at,c.reopen_reason,${closeJson},${identity.id},${identity.role} FROM month_closes c WHERE c.month=${businessMonth} AND ${pending}`,
      sql`UPDATE cloud_operation_receipts SET status=200,result=(SELECT json_object('close',json(${closeJson}),'message',${`Month "${businessMonth}" successfully reopened`}) FROM month_closes c WHERE c.month=${businessMonth})
        WHERE actor_user_id=${identity.id} AND operation='month.reopen' AND operation_id=${key} AND ${pending}`,
    ]);
  }
  if (page === "close" && request.method === "POST") {
    if (url.search) invalid("Unexpected query parameters");
    const businessMonth = month(body.month), cash = amount(body.cashOnHandSen), tng = amount(body.tngOnHandSen), trimmed = note(body.note), confirmEmpty = Boolean(body.confirmEmpty);
    const payload = JSON.stringify({month:businessMonth,cashOnHandSen:cash,tngOnHandSen:tng,note:trimmed,confirmEmpty});
    // Replays must not recompute a snapshot against later edits/close/reopen state.
    const [receipt] = await db.all<Receipt>(receiptQuery(identity,"month.close",key));
    if (receipt) return result(receipt,payload,"");
    for (let attempt=0;attempt<3;attempt++) {
      const [snapshot] = await db.all<Preview>(previewQuery(businessMonth));
      const cashSen = sumSen([BigInt(snapshot.cash)]), tngSen = sumSen([BigInt(snapshot.tng)]);
      const revenue = sumSen([cashSen,tngSen]), cost = sumSen([BigInt(snapshot.cost)]), operating = sumSen([BigInt(snapshot.operating)]);
      const {grossSen,netSen} = computeProfit({revenueSen:revenue,dailyCostSen:cost,operatingSen:operating});
      const r = evaluateReconciliation({expectedSen:netSen,cashOnHandSen:BigInt(cash),tngOnHandSen:BigInt(tng)});
      const at = new Date().toISOString();
      const warning = r.balanced ? null : `Reconciliation mismatch: expected ${r.expectedSen} sen, actual ${r.actualSen} sen (difference: ${r.differenceSen} sen)`;
      const revenueSen=Number(revenue),dailyCostSen=Number(cost),gross=Number(grossSen),operatingSen=Number(operating),net=Number(netSen);
      try {
        return await commit(db,identity,email,"month.close",key,payload,(pending,guard)=>[
          guard(sql`EXISTS(SELECT 1 FROM month_closes WHERE month=${businessMonth} AND (reopened_at IS NULL OR reopened_at=''))`,"BOKLI_MONTH_LOCKED"),
          guard(sql`EXISTS(SELECT 1 FROM (${previewQuery(businessMonth)}) live WHERE cash<>${snapshot.cash} OR tng<>${snapshot.tng} OR cost<>${snapshot.cost} OR operating<>${snapshot.operating} OR sheetCount<>${snapshot.sheetCount})`,"BOKLI_STALE_CLOSE"),
          guard(sql`${snapshot.sheetCount}='0' AND ${confirmEmpty?1:0}=0`,"BOKLI_EMPTY_MONTH"),
          guard(sql`${r.balanced?1:0}=0 AND ${trimmed} IS NULL`,"BOKLI_VARIANCE_NOTE"),
          sql`UPDATE month_closes SET revenue_sen=${revenueSen},daily_cost_sen=${dailyCostSen},gross_sen=${gross},operating_sen=${operatingSen},net_sen=${net},
            cash_on_hand_sen=${cash},tng_on_hand_sen=${tng},note=${trimmed},closed_at=${at},reopened_at=NULL,reopen_reason=NULL WHERE month=${businessMonth} AND ${pending}`,
          sql`INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,cash_on_hand_sen,tng_on_hand_sen,note,closed_at)
            SELECT ${businessMonth},${revenueSen},${dailyCostSen},${gross},${operatingSen},${net},${cash},${tng},${trimmed},${at} WHERE ${pending} AND NOT EXISTS(SELECT 1 FROM month_closes WHERE month=${businessMonth})`,
          sql`INSERT INTO month_close_events(month,action,at,reason,snapshot,actor_user_id,actor_role)
            SELECT c.month,'close',c.closed_at,c.note,${closeJson},${identity.id},${identity.role} FROM month_closes c WHERE c.month=${businessMonth} AND ${pending}`,
          sql`UPDATE cloud_operation_receipts SET status=201,result=(SELECT json_patch(json_object('close',json(${closeJson}),'balanced',json(${r.balanced?'true':'false'}),
            'differenceSen',${Number(r.differenceSen)},'expectedSen',${Number(r.expectedSen)},'actualSen',${Number(r.actualSen)}),CASE WHEN ${warning} IS NULL THEN '{}' ELSE json_object('warning',${warning}) END) FROM month_closes c WHERE c.month=${businessMonth})
            WHERE actor_user_id=${identity.id} AND operation='month.close' AND operation_id=${key} AND ${pending}`,
        ]);
      } catch (error) {
        if (writeGuardError(error)?.code !== "closeChanged") throw error;
        if (attempt===2) throw new WriteError(409,"closeChanged","Month changed during close; review its current totals");
      }
    }
  }
  if (page === "sheets" && request.method === "DELETE") {
    if (!bodylessDelete || [...url.searchParams.keys()].some(k=>!["date","id","updatedAt"].includes(k)) || [...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1)) invalid("Invalid Daily Sheet delete query");
    const businessDate = url.searchParams.get("date");
    if (!businessDate || !isValidDateStr(businessDate)) invalid("Invalid date format, expected YYYY-MM-DD");
    const parsedId = parsePositiveId(url.searchParams.get("id"),"id");
    if (!parsedId.ok) invalid(parsedId.error);
    const updatedAt = url.searchParams.get("updatedAt");
    if (!updatedAt || updatedAt.length>100) invalid("updatedAt is required");
    const id = parsedId.id;
    return commit(db,identity,email,"sheet.delete",key,JSON.stringify({date:businessDate,id,updatedAt}),(pending,guard)=>[
      guard(sql`NOT EXISTS(SELECT 1 FROM daily_sheets WHERE date=${businessDate})`,"BOKLI_NOT_FOUND"),
      guard(sql`EXISTS(SELECT 1 FROM month_closes WHERE month=${businessDate.slice(0,7)} AND (reopened_at IS NULL OR reopened_at=''))`,"BOKLI_MONTH_LOCKED"),
      guard(sql`NOT EXISTS(SELECT 1 FROM daily_sheets WHERE date=${businessDate} AND id=${id} AND updated_at=${updatedAt})`,"BOKLI_SHEET_CHANGED"),
      sql`DELETE FROM daily_sheets WHERE date=${businessDate} AND id=${id} AND updated_at=${updatedAt} AND ${pending}`,
      sql`UPDATE cloud_operation_receipts SET status=200,result=json_object('deleted',json('true'),'date',${businessDate})
        WHERE actor_user_id=${identity.id} AND operation='sheet.delete' AND operation_id=${key} AND ${pending}`,
    ]);
  }
  if (page === "expenses" && request.method === "POST") {
    if (url.search) invalid("Unexpected query parameters");
    const businessMonth = month(body.month,"saveError");
    if (typeof body.type !== "string" || !OPERATING_EXPENSE_TYPES.includes(body.type as typeof OPERATING_EXPENSE_TYPES[number])) invalid("Invalid Operating Expense type");
    const expenseType = body.type, value = amount(body.amountSen), trimmed = note(body.note);
    if (expenseType === "other" && !trimmed) invalid("Note is required for other","otherNoteRequired");
    const payload = JSON.stringify({month:businessMonth,type:expenseType,amountSen:value,note:trimmed});
    const legacy = await legacyReceipt(db,key,identity);
    if (legacy) {
      if (legacy.owner !== String(identity.id)) throw new WriteError(409,"legacyReceiptUnscoped","Historical expense key requires explicit ownership verification");
      if (legacy.month !== businessMonth || legacy.type !== expenseType || legacy.amount !== String(value) || legacy.note !== trimmed) invalid("Idempotency key was already used for a different Operating Expense");
      return {body:legacyResult(legacy.result),status:200,replayed:true};
    }
    const target = sql`month=${businessMonth} AND type=${expenseType} AND note IS ${trimmed}`;
    const response = await commit(db,identity,email,"expense.add",key,payload,(pending,guard) => [
      guard(sql`EXISTS(SELECT 1 FROM operating_expenses WHERE ${target} AND (id<1 OR id>${MAX} OR typeof(amount_sen)<>'integer' OR amount_sen<0 OR amount_sen>${MAX}))`,"BOKLI_MONEY_RANGE"),
      guard(sql`EXISTS(SELECT 1 FROM operating_expenses WHERE ${target} AND amount_sen>${MAX}-${value})`,"BOKLI_EXPENSE_OVERFLOW"),
      guard(sql`EXISTS(SELECT 1 FROM operating_expense_add_requests WHERE idempotency_key=${key})`,"BOKLI_LEGACY_SCOPE"),
      sql`UPDATE operating_expenses SET amount_sen=amount_sen+${value},updated_at=${new Date().toISOString()} WHERE ${target} AND ${pending}`,
      sql`INSERT INTO operating_expenses(month,type,amount_sen,note) SELECT ${businessMonth},${expenseType},${value},${trimmed}
        WHERE ${pending} AND NOT EXISTS(SELECT 1 FROM operating_expenses WHERE ${target})`,
      sql`UPDATE cloud_operation_receipts SET status=CASE WHEN changes()=0 THEN 200 ELSE 201 END,
        result=(SELECT json_object('expense',json(${expenseJson}),'merged',json(CASE WHEN changes()=0 THEN 'true' ELSE 'false' END),'alreadySaved',json('false')) FROM operating_expenses e WHERE ${target})
        WHERE actor_user_id=${identity.id} AND operation='expense.add' AND operation_id=${key} AND ${pending}`,
    ]);
    return response.replayed ? {...response,status:200,body:expenseReplay(response.body)} : response;
  }
  if (page === "expenses" && request.method === "DELETE") {
    if (url.search) invalid("Unexpected query parameters");
    if (!Array.isArray(body.ids) || body.ids.length<1 || body.ids.length>50) invalid("ids must contain 1 to 50 IDs");
    const ids = [...new Set(body.ids.map(value => {
      const id = parsePositiveId(value,"ids entry"); if (!id.ok) invalid(id.error); return id.id;
    }))].sort((a,b)=>a-b);
    const inIds = sql`id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`;
    return commit(db,identity,email,"expense.delete",key,JSON.stringify({ids}),(pending) => [
      sql`DELETE FROM operating_expenses WHERE ${inIds} AND ${pending}`,
      sql`UPDATE cloud_operation_receipts SET status=200,result=json_object('deleted',changes()) WHERE actor_user_id=${identity.id} AND operation='expense.delete' AND operation_id=${key} AND ${pending}`,
    ]);
  }
  if (page !== "sheets" || request.method !== "POST") throw new ApiError(405,"mutationNotSupported");
  if (url.search) invalid("Unexpected query parameters");
  const businessDate = date(body.date);
  if (["sheetId","category","amountSen","note","action"].some(k => body[k] !== undefined)) invalid("Unexpected legacy field");
  if (!Array.isArray(body.costLines) || body.costLines.length > 30) invalid("costLines must be an array of at most 30 Cost Lines");
  const validated = body.costLines.map(line => {
    if (!line || typeof line !== "object" || Array.isArray(line)) invalid("Each Cost Line must be an object");
    const amountSen = amount(line.amountSen);
    if (!amountSen) invalid("Daily Cost amount must be greater than 0", "invalidAmount");
    if (!COST_CATEGORIES.includes(line.category)) invalid("Invalid Cost Category");
    const trimmed = note(line.note);
    if (line.category === "other" && !trimmed) invalid("Note is required for other", "otherNoteRequired");
    return { category: line.category as string, amountSen, note: trimmed };
  });
  let lines: {category:string;amountSen:number;note:string|null}[];
  try { lines = groupCostLines(validated).map(({category,amountSen,note}) => ({category,amountSen,note})); }
  catch(error) { if(error instanceof CostLineAmountOverflowError) invalid(error.message,"invalidAmount"); throw error; }
  if (lines.length > 30) invalid("Too many Cost Lines");
  const cash = body.cashSen === undefined ? null : amount(body.cashSen);
  const tng = body.tngSen === undefined ? null : amount(body.tngSen);
  const totalCost = Number(sumSen(lines.map(l => BigInt(l.amountSen))));
  if (cash !== null && tng !== null) subSen(sumSen([BigInt(cash),BigInt(tng)]), BigInt(totalCost));
  const payload = JSON.stringify({ date: businessDate, cashSen: cash, tngSen: tng, costLines: lines });
  const response = await commit(db,identity,email,"sheet.save",key,payload,(pending,guard) => [
    sql`INSERT INTO daily_sheets(date,cash_sen,tng_sen) SELECT ${businessDate},COALESCE(${cash},0),COALESCE(${tng},0) WHERE ${pending}
      ON CONFLICT(date) DO UPDATE SET cash_sen=COALESCE(${cash},cash_sen),tng_sen=COALESCE(${tng},tng_sen),
      updated_at=max(${new Date().toISOString()},coalesce(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds'),${new Date().toISOString()}))`,
    sql`DELETE FROM cost_lines WHERE daily_sheet_id=(SELECT id FROM daily_sheets WHERE date=${businessDate}) AND ${pending}`,
    ...lines.map(l => sql`INSERT INTO cost_lines(daily_sheet_id,amount_sen,category,note) SELECT id,${l.amountSen},${l.category},${l.note} FROM daily_sheets WHERE date=${businessDate} AND ${pending}`),
    guard(sql`EXISTS(SELECT 1 FROM daily_sheets s WHERE date=${businessDate} AND (id<1 OR id>${MAX} OR cash_sen>${MAX} OR tng_sen>${MAX} OR cash_sen+tng_sen>${MAX})) OR
      EXISTS(SELECT 1 FROM cost_lines WHERE daily_sheet_id=(SELECT id FROM daily_sheets WHERE date=${businessDate}) AND (id<1 OR id>${MAX}))`,"BOKLI_MONEY_RANGE"),
    sql`UPDATE cloud_operation_receipts SET status=201,result=(SELECT json_object('sheet',json(${sheetJson}),'costLines',json(${linesJson}),
      'totalCostSen',${totalCost},'totalRevenueSen',s.cash_sen+s.tng_sen,'grossProfitSen',s.cash_sen+s.tng_sen-${totalCost}) FROM daily_sheets s WHERE date=${businessDate})
      WHERE actor_user_id=${identity.id} AND operation='sheet.save' AND operation_id=${key} AND ${pending}`,
  ]);
  return response;
}
