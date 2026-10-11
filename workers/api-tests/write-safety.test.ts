import { env,fetchMock } from "cloudflare:test";
import { beforeEach,afterEach,expect,it } from "vitest";
import { writeFixture,daily,expense,records,instrument } from "./write-fixtures";
let f:Awaited<ReturnType<typeof writeFixture>>;
beforeEach(async()=>{f=await writeFixture();});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
it("keeps three competing complete saves intact and timestamps strictly increasing",async()=>{
  const submissions=[1,2,3].map(n=>({...daily,cashSen:n*1000,costLines:[{category:"gas",amountSen:n*100,note:`save-${n}`},{category:"restock",amountSen:n*200}]}));
  const replies=await Promise.all(submissions.map((b,n)=>f.send("sheets","POST",b,`save-${n}`)));
  expect(replies.map(r=>r.status)).toEqual([201,201,201]);
  const saved=await Promise.all(replies.map(r=>r.json())) as any[];
  expect(new Set(saved.map(s=>s.sheet.id)).size).toBe(1);
  expect(new Set(saved.map(s=>s.sheet.updatedAt)).size).toBe(3);
  const current=await (await f.send("sheets?date="+daily.date)).json() as any;
  const winner=saved.find(s=>s.sheet.updatedAt===current.data.sheet.updatedAt);
  expect(current.data).toEqual(winner);
});
it("normalizes receipt payloads and rejects changed-body reuse without writes",async()=>{
  const original=await f.send("expenses","POST",{...expense,note:"  rent  "},"normalized");
  expect(original.status).toBe(201);
  expect((await f.send("expenses","POST",{...expense,note:"rent"},"normalized")).status).toBe(200);
  const before=await records();
  expect((await f.send("expenses","POST",{...expense,note:"rent",amountSen:1},"normalized")).status).toBe(400);
  expect(await records()).toEqual(before);
});
it("accepts one of concurrent changed-body same-key adds and rejects the other",async()=>{
  const responses=await Promise.all([f.send("expenses","POST",expense,"changed-race"),f.send("expenses","POST",{...expense,amountSen:1},"changed-race")]);
  expect(responses.map(r=>r.status).sort()).toEqual([201,400].sort());
  const accepted=await responses.find(r=>r.status===201)!.json() as any;
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(accepted.expense.amountSen);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM cloud_operation_receipts").first("count(*)")).toBe(1);
});
it("rechecks mapped permission inside the committed write batch",async()=>{
  const revoked=instrument(env.BOKLI_DB,async(statements)=>{await env.BOKLI_DB.prepare("UPDATE users SET role='Operator' WHERE id=2").run();return statements;});
  expect((await f.send("expenses","POST",expense,"revoked-at-commit",f.admin,revoked.binding)).status).toBe(403);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM operating_expenses").first("count(*)")).toBe(0);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM cloud_operation_receipts").first("count(*)")).toBe(0);
});
it("scopes replay/status to current mapped identity and enforces Admin on reopen status",async()=>{
  await f.send("expenses","POST",expense,"shared");
  expect(await (await f.send("expenses?idempotencyKey=shared","GET",undefined,undefined,f.admin)).json()).toEqual({saved:false});
  expect((await f.send("expenses","POST",expense,"shared",f.admin)).status).toBe(200);
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(2400);
  expect((await f.send("operations/status?operation=month.reopen&operationId=shared")).status).toBe(403);
  await env.BOKLI_DB.prepare("DELETE FROM user_emails WHERE user_id=1").run();
  expect((await f.send("expenses?idempotencyKey=shared")).status).toBe(403);
  expect((await f.send("expenses","POST",expense,"shared")).status).toBe(403);
});
it("denies a persisted Mom operation after the signed caller switches to Admin",async()=>{
  await f.send("expenses","POST",expense,"account-switch");
  const headers={"X-Bokli-Actor-Id":"1"};
  const responses=await Promise.all([
    f.send("expenses?idempotencyKey=account-switch","GET",undefined,undefined,f.admin,env.BOKLI_DB,headers),
    f.send("expenses","POST",expense,"account-switch",f.admin,env.BOKLI_DB,headers),
  ]);
  expect(responses.map(r=>r.status)).toEqual([403,403]);
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(1200);
});
it("preserves explicit legacy receipts after deletion/close and never guesses ownership",async()=>{
  const result={id:41,...expense,createdAt:"2026-01-02 00:00:00",updatedAt:"2026-01-02 00:00:00",merged:false,alreadySaved:false};
  await env.BOKLI_DB.prepare("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,note,result) VALUES ('historical','2026-01','rental',1200,NULL,?)").bind(JSON.stringify(result)).run();
  const before=await records();
  expect((await f.send("expenses","POST",expense,"historical")).status).toBe(409);
  expect((await f.send("expenses?idempotencyKey=historical")).status).toBe(409);
  expect(await records()).toEqual(before);
  await env.BOKLI_DB.prepare("INSERT INTO legacy_expense_receipt_owners VALUES ('historical',1)").run();
  expect((await f.send("close","POST",{month:expense.month,cashOnHandSen:0,tngOnHandSen:0,confirmEmpty:true},"historical-close")).status).toBe(201);
  const replay=await f.send("expenses","POST",expense,"historical");
  expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({expense:{...result,alreadySaved:true},alreadySaved:true});
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM operating_expenses").first("count(*)")).toBe(0);
  expect(await (await f.send("expenses?idempotencyKey=historical")).json()).toMatchObject({saved:true});
  expect(await (await f.send("expenses?idempotencyKey=historical","GET",undefined,undefined,f.admin)).json()).toEqual({saved:false});
  expect((await f.send("expenses","POST",expense,"historical",f.admin)).status).toBe(409);
});
it("keeps a scoped accepted expense result if an older unscoped key is later imported",async()=>{
  const response=await f.send("expenses","POST",expense,"later-import");
  const accepted=await response.json() as any;
  await env.BOKLI_DB.prepare("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,note,result) VALUES ('later-import','2026-01','rental',1,NULL,?)").bind(JSON.stringify({...accepted.expense,amountSen:1})).run();
  const replay=await f.send("expenses","POST",expense,"later-import");
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({expense:{amountSen:1200},alreadySaved:true});
});
it("checks maintenance at commit and keeps status/replays usable during maintenance",async()=>{
  await f.send("sheets","POST",daily,"before-maintenance");
  const proxy=instrument(env.BOKLI_DB,async(s)=>{await env.BOKLI_DB.prepare("UPDATE cloud_write_guard SET maintenance=1 WHERE id=1").run();return s;});
  expect((await f.send("sheets","POST",{...daily,cashSen:5000},"race-maintenance",f.mom,proxy.binding)).status).toBe(503);
  expect(await env.BOKLI_DB.prepare("SELECT cash_sen FROM daily_sheets").first("cash_sen")).toBe(1200);
  expect(await (await f.send("operations/status?operation=sheet.save&operationId=race-maintenance")).json()).toEqual({saved:false});
  expect((await f.send("sheets","POST",daily,"before-maintenance")).status).toBe(201);
});
it("resolves committed lost responses and precommit timeout with the same durable request",async()=>{
  const lost=instrument(env.BOKLI_DB,undefined,()=>{throw new Error("test transport lost after commit");});
  const response=await f.send("expenses","POST",expense,"lost-response",f.mom,lost.binding);
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"outcomeUnknown"});
  expect(await (await f.send("expenses?idempotencyKey=lost-response")).json()).toMatchObject({saved:true,result:{expense:{amountSen:1200}}});
  expect((await f.send("expenses","POST",expense,"lost-response")).status).toBe(200);
  const timeout=instrument(env.BOKLI_DB,async()=>{throw new Error("test precommit timeout 1102");});
  expect((await f.send("expenses","POST",expense,"precommit",f.mom,timeout.binding)).status).toBe(503);
  expect(await (await f.send("expenses?idempotencyKey=precommit")).json()).toEqual({saved:false});
  expect((await f.send("expenses","POST",expense,"precommit")).status).toBe(200);
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(2400);
});
it("never treats overflow-like words in an unknown committed-response error as rollback",async()=>{
  const lost=instrument(env.BOKLI_DB,undefined,()=>{throw new Error("Unknown transport context includes integer overflow words");});
  const response=await f.send("expenses","POST",expense,"misleading-error",f.mom,lost.binding);
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"outcomeUnknown"});
  expect(await (await f.send("expenses?idempotencyKey=misleading-error")).json()).toMatchObject({saved:true,result:{expense:{amountSen:1200}}});
});
it("replays an accepted sheet after deletion and later close without recreating it",async()=>{
  const original=await (await f.send("sheets","POST",daily,"historical-save")).json() as any;
  expect((await f.send(`sheets?date=${daily.date}&id=${original.sheet.id}&updatedAt=${encodeURIComponent(original.sheet.updatedAt)}`,"DELETE",undefined,"delete-historical")).status).toBe(200);
  expect((await f.send("close","POST",{month:"2026-01",cashOnHandSen:0,tngOnHandSen:0,confirmEmpty:true},"close-after-delete")).status).toBe(201);
  const replay=await f.send("sheets","POST",daily,"historical-save");expect(replay.status).toBe(201);expect(await replay.json()).toEqual(original);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM daily_sheets").first("count(*)")).toBe(0);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(1);
});
it("rejects cross-origin, missing CSRF, bad content type, service writes and unsupported methods",async()=>{
  const before=await records();
  const headers:Record<string,string>[]=[{Origin:"https://other.invalid"},{Origin:""},{"X-Bokli-Api-Generation":""},{"Content-Type":"text/plain"},{"Sec-Fetch-Site":"cross-site"}];
  for(const extra of headers)
    expect((await f.send("sheets","POST",daily,"security",f.mom,env.BOKLI_DB,extra)).status).toBeGreaterThanOrEqual(400);
  for(const method of ["PUT","PATCH"] ) expect((await f.send("sheets",method,daily,"security")).status).toBe(405);
  expect(await records()).toEqual(before);
});
