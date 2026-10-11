import { env,fetchMock } from "cloudflare:test";
import { beforeEach,afterEach,expect,it } from "vitest";
import { writeFixture,daily,expense,close,records,instrument } from "./write-fixtures";
let f:Awaited<ReturnType<typeof writeFixture>>;
beforeEach(async()=>{f=await writeFixture();});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
it("rejects 31 submitted Cost Lines even when normalization would merge them",async()=>{
  const before=await records();
  expect((await f.send("sheets","POST",{...daily,costLines:Array.from({length:31},()=>({category:"gas",amountSen:1}))},"31")).status).toBe(400);
  expect(await records()).toEqual(before);
  expect((await f.send("sheets","POST",{...daily,costLines:Array.from({length:30},()=>({category:"gas",amountSen:1}))},"30")).status).toBe(201);
  expect(await env.BOKLI_DB.prepare("SELECT amount_sen FROM cost_lines").first("amount_sen")).toBe(30);
});
it("rejects group overflow with the retained invalidAmount response and no mutation",async()=>{
  const before=await records();
  const response=await f.send("sheets","POST",{...daily,costLines:[{category:"gas",amountSen:Number.MAX_SAFE_INTEGER},{category:"gas",amountSen:1}]},"overflow");
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"invalidAmount"});expect(await records()).toEqual(before);
});
it("preserves invalidAmount when a valid expense component overflows its merged total",async()=>{
  expect((await f.send("expenses","POST",{...expense,amountSen:Number.MAX_SAFE_INTEGER},"maximum-expense")).status).toBe(201);
  const before=await records();
  const response=await f.send("expenses","POST",{...expense,amountSen:1},"merged-overflow");
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"invalidAmount"});
  expect(await records()).toEqual(before);
  expect((await f.send("expenses","POST",{...expense,amountSen:Number.MAX_SAFE_INTEGER},"maximum-expense")).status).toBe(200);
});
it.each([
  {costLines:[{category:"other",amountSen:1,note:null}]},
  {costLines:[{category:"gas",amountSen:0}]},
  {costLines:[{category:"unknown",amountSen:1}]},
  {costLines:[{category:"gas",amountSen:1,note:42}]},
  {cashSen:0.1},{cashSen:-1},{cashSen:Number.MAX_SAFE_INTEGER+1},{date:"2026-02-30"},{date:"9999-12-31"},
])("rejects invalid Daily Sheet payload %j without claiming a receipt",async(patch)=>{
  const before=await records();expect((await f.send("sheets","POST",{...daily,...patch},"invalid")).status).toBe(400);expect(await records()).toEqual(before);
});
it("rejects unsafe revenue totals even when costs would cancel the final profit",async()=>{
  const before=await records();
  expect((await f.send("sheets","POST",{...daily,cashSen:Number.MAX_SAFE_INTEGER,tngSen:1,costLines:[{category:"gas",amountSen:1}]},"cancel")).status).toBe(422);
  expect(await records()).toEqual(before);
});
it("checks unsafe stored IDs and signed int64 components before publishing a response",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO daily_sheets(id,date,cash_sen,tng_sen) VALUES (9007199254740993,'2026-01-02',1,0)").run();
  const before=await records();
  expect((await f.send("sheets","POST",daily,"id-overflow")).status).toBe(422);expect(await records()).toEqual(before);
  await env.BOKLI_DB.prepare("UPDATE daily_sheets SET cash_sen=9223372036854775807 WHERE date='2026-01-02'").run();
  expect((await f.send("close","POST",close,"int64-close")).status).toBe(422);
});
it("rejects non-positive stored Month Close IDs atomically for close and reopen",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO month_closes(id,month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,reopened_at,reopen_reason) VALUES (0,'2026-01',0,0,0,0,0,NULL,NULL),(-1,'2026-02',0,0,0,0,0,'2026-02-01','correction')").run();
  const before=await records();
  for(const [route,body,actor] of [
    ["close/reopen",{month:"2026-01",reason:"correct"},f.admin],
    ["close",{month:"2026-02",cashOnHandSen:0,tngOnHandSen:0,confirmEmpty:true},f.mom],
  ] as const) {
    expect((await f.send(route,"POST",body,"invalid-close-id",actor)).status).toBe(422);expect(await records()).toEqual(before);
  }
});
it("detects SQL SUM int64 overflow and unsafe reconciliation intermediates",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES ('2026-01-02',9223372036854775807,0),('2026-01-03',1,0)").run();
  const before=await records();
  expect((await f.send("close","POST",close,"aggregate-overflow")).status).toBe(422);expect(await records()).toEqual(before);
  expect((await f.send("close","POST",{month:"2026-02",cashOnHandSen:Number.MAX_SAFE_INTEGER,tngOnHandSen:1,confirmEmpty:true},"hands-overflow")).status).toBe(422);
});
it("accepts at most 50 bulk IDs and retains strict ID parsing",async()=>{
  const before=await records();
  for(const ids of [Array.from({length:51},(_,n)=>n+1),[" 1"],["1e2"],[true],[0]]) expect((await f.send("expenses","DELETE",{ids},"ids-invalid")).status).toBe(400);
  expect(await records()).toEqual(before);
  expect((await f.send("expenses","DELETE",{ids:Array.from({length:50},(_,n)=>n+1)},"50")).status).toBe(200);
},30000);
it("records actual authenticated write/status/replay/error statement and parameter bounds",async()=>{
  for(let n=0;n<50;n++) await f.send("expenses","POST",{...expense,note:`expense-${n}`},`seed-${n}`);
  const cases:[string,string,unknown,string|undefined,string][]=[
    ["sheets","POST",{...daily,costLines:Array.from({length:30},(_,n)=>({category:"gas",amountSen:n+1,note:`line-${n}`}))},"max-save",f.mom],
    ["expenses","POST",expense,"add",f.mom],["expenses","POST",expense,"merge",f.mom],["expenses","POST",expense,"add",f.mom],
    ["expenses?idempotencyKey=add","GET",undefined,undefined,f.mom],
    ["expenses","DELETE",{ids:Array.from({length:50},(_,n)=>n+1)},"max-delete",f.mom],
    ["close","POST",{...close,note:"reconciliation"},"close",f.mom],
    ["close/reopen","POST",{month:"2026-01",reason:"correct"},"reopen",f.admin],
    ["sheets","POST",{...daily,costLines:[]},"max-save",f.mom],
  ];
  const evidence=[];
  for(const [path,method,body,key,identity] of cases) {
    const measured=instrument(env.BOKLI_DB);
    const response=await f.send(path,method,body,key,identity,measured.binding);
    const executed=measured.queries.filter(q=>q.executed);
    expect(executed.length).toBeGreaterThan(0);expect(executed.length).toBeLessThanOrEqual(50);
    expect(Math.max(...executed.map(q=>q.parameters.length))).toBeLessThanOrEqual(100);
    evidence.push({path,method,status:response.status,statements:executed.length,maxParameters:Math.max(...executed.map(q=>q.parameters.length)),maxSqlBytes:Math.max(...executed.map(q=>new TextEncoder().encode(q.sql).length)),queries:executed.map(q=>({sql:q.sql,parameters:q.parameters.length,executed:q.executed}))});
  }
  console.log("STAGE4_WRITE_METRICS",JSON.stringify({costLines:30,deleteIds:50,evidence}));
},60000);
