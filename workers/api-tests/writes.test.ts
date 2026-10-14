import { applyD1Migrations, env, fetchMock } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import worker from "../index";
import { signingKey, token, jwks, seedIdentity, type SigningKey } from "./jwt-fixtures";

let key: SigningKey;
let jwt: string;
beforeEach(async () => {
  fetchMock.activate(); fetchMock.disableNetConnect();
  await applyD1Migrations(env.BOKLI_DB, env.TEST_MIGRATIONS);
  await seedIdentity();
  key = await signingKey(); jwt = await token(key);
});

it("accepts bodyless Daily Sheet deletion and rejects a stale saved token", async () => {
  const initial = await (await send("sheets","POST",sheet,"delete-source")).json() as any;
  const later = await (await send("sheets","POST",{...sheet,cashSen:2400},"delete-edit")).json() as any;
  expect(later.sheet.id).toBe(initial.sheet.id); expect(later.sheet.updatedAt > initial.sheet.updatedAt).toBe(true);
  const query = (row:any) => `sheets?date=${sheet.date}&id=${row.id}&updatedAt=${encodeURIComponent(row.updatedAt)}`;
  const stale = await send(query(initial.sheet),"DELETE",undefined,"delete-stale");
  expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({code:"sheetChanged"});
  expect((await send(query(later.sheet),"DELETE",undefined,"delete-final")).status).toBe(200);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM cost_lines").first("count(*)")).toBe(0);
  expect((await send(query(later.sheet),"DELETE",undefined,"delete-final")).status).toBe(200);
});
it("accepts the empty body a browser sends with a bodyless Daily Sheet DELETE", async () => {
  const saved = await (await send("sheets","POST",sheet,"browser-source")).json() as any;
  jwks([key]);
  const reply = await worker.fetch(new Request(`https://synthetic.invalid/api/cloud-v1/sheets?date=${sheet.date}&id=${saved.sheet.id}&updatedAt=${encodeURIComponent(saved.sheet.updatedAt)}`, {
    method: "DELETE", body: "", headers: { "Cf-Access-Jwt-Assertion": jwt, "Origin": "https://synthetic.invalid", "X-Bokli-Api-Generation": "cloud-v1", "Idempotency-Key": "browser-delete" },
  }), env);
  expect(reply.status).toBe(200);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) AS n FROM daily_sheets").first("n")).toBe(0);
});
afterEach(() => { fetchMock.assertNoPendingInterceptors(); fetchMock.deactivate(); });
async function send(path: string, method = "GET", body?: unknown, operationId?: string, identity = jwt) {
  jwks([key]);
  return worker.fetch(new Request(`https://synthetic.invalid/api/cloud-v1/${path}`, {
    method, headers: { "Cf-Access-Jwt-Assertion": identity, "Origin": "https://synthetic.invalid",
      "X-Bokli-Api-Generation": "cloud-v1", ...(operationId ? { "Idempotency-Key": operationId } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}
const sheet = { date: "2026-01-02", cashSen: 1200, tngSen: 300,
  costLines: [{ category: "gas", amountSen: 250, note: null }] };

it("atomically saves a Daily Sheet and replays the complete original result after a later edit", async () => {
  const response = await send("sheets", "POST", sheet, "save-original");
  expect(response.status).toBe(201);
  const original = await response.json();
  expect(original).toMatchObject({ sheet: { date: sheet.date, cashSen: 1200, tngSen: 300 },
    costLines: [{ category: "gas", amountSen: 250 }], totalRevenueSen: 1500, totalCostSen: 250, grossProfitSen: 1250 });
  expect((await send("sheets", "POST", { ...sheet, cashSen: 2300 }, "save-later")).status).toBe(201);
  const replay = await send("sheets", "POST", sheet, "save-original");
  expect(replay.status).toBe(201); expect(await replay.json()).toEqual(original);
  expect(await env.BOKLI_DB.prepare("SELECT cash_sen FROM daily_sheets").first("cash_sen")).toBe(2300);
});

it("adds an expense once for concurrent same-key requests and keeps its replay after deletion", async () => {
  const expense = {month:"2026-01",type:"rental",amountSen:1200,note:null};
  const replies = await Promise.all([send("expenses","POST",expense,"expense-1"),send("expenses","POST",expense,"expense-1")]);
  expect(replies.map(r=>r.status).sort()).toEqual([200,201]);
  const bodies = await Promise.all(replies.map(r=>r.json())) as any[];
  expect(bodies.map(b=>b.alreadySaved).sort()).toEqual([false,true]);
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(1200);
  expect((await send("expenses","DELETE",{ids:[bodies[0].expense.id]},"delete-expense")).status).toBe(200);
  const replay = await send("expenses","POST",expense,"expense-1");
  expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({alreadySaved:true,expense:{amountSen:1200}});
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM operating_expenses").first("count(*)")).toBe(0);
  const status = await send("expenses?idempotencyKey=expense-1");
  expect(await status.json()).toMatchObject({saved:true});
});

it("closes, reopens and recloses with one actor snapshot per accepted operation", async () => {
  await send("sheets","POST",sheet,"close-sheet");
  const body = {month:"2026-01",cashOnHandSen:1250,tngOnHandSen:0,note:null};
  const closed = await send("close","POST",body,"close-1");
  expect(closed.status).toBe(201);
  const original = await closed.json();
  expect(original).toMatchObject({close:{netSen:1250,reopenedAt:null},balanced:true,differenceSen:0});
  expect((await send("sheets","POST",sheet,"locked-save")).status).toBe(409);
  expect((await send("close/reopen","POST",{month:body.month,reason:"correct"},"operator-reopen")).status).toBe(403);
  const admin = await token(key,{email:"admin@example.invalid",sub:"synthetic-admin"});
  expect((await send("close/reopen","POST",{month:body.month,reason:"correct"},"reopen-1",admin)).status).toBe(200);
  expect((await send("close","POST",body,"close-2")).status).toBe(201);
  expect(await (await send("close","POST",body,"close-1")).json()).toEqual(original);
  const events = (await env.BOKLI_DB.prepare("SELECT action,actor_user_id,actor_role,snapshot,reason FROM month_close_events ORDER BY id").all()).results;
  expect(events.map(e=>[e.action,e.actor_user_id,e.actor_role])).toEqual([["close",1,"Operator"],["reopen",2,"Admin"],["close",1,"Operator"]]);
  expect(events[1].reason).toBe("correct");
  expect(JSON.parse(events[2].snapshot as string)).toMatchObject({netSen:1250,reopenedAt:null,reopenReason:null});
});
