import { env,fetchMock } from "cloudflare:test";
import { beforeEach,afterEach,expect,it } from "vitest";
import { writeFixture,daily,expense,close,records,instrument } from "./write-fixtures";
let f:Awaited<ReturnType<typeof writeFixture>>;
beforeEach(async()=>{f=await writeFixture();});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
it.each([false,true])("rolls back every statement boundary of a 30-line save (existing=%s)",async(existing)=>{
  if(existing) await f.send("sheets","POST",daily,"initial");
  const body={...daily,cashSen:9999,costLines:Array.from({length:30},(_,n)=>({category:"gas",amountSen:n+1,note:`line-${n}`}))};
  let length=0;
  const counting=instrument(env.BOKLI_DB,async(s)=>{length=s.length;throw new Error("test count without commit");});
  expect((await f.send("sheets","POST",body,"count",f.mom,counting.binding)).status).toBe(503);
  expect(length).toBeGreaterThan(30);
  const original=await records();
  for(let position=0;position<=length;position++) {
    const fault=instrument(env.BOKLI_DB,async(s,session)=>{const copy=[...s];copy.splice(position,0,session.prepare("UPDATE cloud_write_guard SET check_code='BOKLI_RESULT_MISSING' WHERE id=1"));return copy;});
    expect((await f.send("sheets","POST",body,`fault-${position}`,f.mom,fault.binding)).status,`position ${position}`).toBe(503);
    expect(await records(),`position ${position}`).toEqual(original);
  }
  console.log("STAGE4_SAVE_FAULT_POSITIONS",JSON.stringify({existing,positions:length+1}));
},120000);
it("serializes close versus save and two competing closes",async()=>{
  await f.send("sheets","POST",daily,"first");
  const replies=await Promise.all([f.send("close","POST",{...close,note:"race reconciliation"},"close-race"),f.send("sheets","POST",{...daily,cashSen:2000},"save-race")]);
  expect(replies[0].status).toBe(201);expect([201,409]).toContain(replies[1].status);
  const live=await env.BOKLI_DB.prepare("SELECT cash_sen FROM daily_sheets").first<number>("cash_sen");
  const saved=await (await f.send("close?month=2026-01")).json() as any;
  expect(saved.closeRecord.netSen).toBe(live!+300-250);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(1);
  await f.send("close/reopen","POST",{month:"2026-01",reason:"race"},"open",f.admin);
  const contenders=await Promise.all([f.send("close","POST",{...close,note:"reclose"},"reclose-a"),f.send("close","POST",{...close,note:"reclose"},"reclose-b")]);
  expect(contenders.map(r=>r.status).sort()).toEqual([201,409]);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(3);
},120000);
it("detects zero-value sheet disappearance by count and retries a changed close snapshot",async()=>{
  const zero={...daily,cashSen:0,tngSen:0,costLines:[]};await f.send("sheets","POST",zero,"zero");
  let calls=0;
  const race=instrument(env.BOKLI_DB,async(s)=>{if(calls++===0) await env.BOKLI_DB.prepare("DELETE FROM daily_sheets").run();return s;});
  const reply=await f.send("close","POST",{month:"2026-01",cashOnHandSen:0,tngOnHandSen:0,confirmEmpty:true},"zero-close",f.mom,race.binding);
  expect(reply.status).toBe(201);expect(calls).toBe(2);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(1);
});
it("requires empty-month confirmation after a zero-value sheet disappears",async()=>{
  await f.send("sheets","POST",{...daily,cashSen:0,tngSen:0,costLines:[]},"zero");
  let calls=0;
  const race=instrument(env.BOKLI_DB,async(statements)=>{if(calls++===0) await env.BOKLI_DB.prepare("DELETE FROM daily_sheets").run();return statements;});
  const response=await f.send("close","POST",{month:"2026-01",cashOnHandSen:0,tngOnHandSen:0},"empty-disappearance",f.mom,race.binding);
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"saveError"});expect(calls).toBe(2);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(0);
  expect(await (await f.send("operations/status?operation=month.close&operationId=empty-disappearance")).json()).toEqual({saved:false});
});
it("stops stale snapshot retries at three and leaves no receipt or audit",async()=>{
  await f.send("sheets","POST",daily,"first");
  let calls=0;
  const race=instrument(env.BOKLI_DB,async(s)=>{calls++;await env.BOKLI_DB.prepare("UPDATE daily_sheets SET cash_sen=cash_sen+1").run();return s;});
  const reply=await f.send("close","POST",{...close,note:"concurrent"},"never-close",f.mom,race.binding);
  expect(reply.status).toBe(409);expect(await reply.json()).toMatchObject({code:"closeChanged"});expect(calls).toBe(3);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(0);
  expect(await (await f.send("operations/status?operation=month.close&operationId=never-close")).json()).toEqual({saved:false});
  const submitted=race.queries.reduce((n,q)=>n+q.submitted,0);
  expect(submitted).toBeLessThanOrEqual(50);
  console.log("STAGE4_STALE_CLOSE_BOUND",JSON.stringify({attempts:calls,submittedStatements:submitted,successfulStatements:race.queries.reduce((n,q)=>n+q.executed,0),failedBatchPrefix:"D1 does not return per-statement execution metadata for failed atomic batches"}));
});
it("serializes two reopens and a save against the closed month",async()=>{
  await f.send("sheets","POST",daily,"initial");await f.send("close","POST",close,"close");
  const responses=await Promise.all([
    f.send("close/reopen","POST",{month:"2026-01",reason:"first"},"first-open",f.admin),
    f.send("close/reopen","POST",{month:"2026-01",reason:"second"},"second-open",f.admin),
    f.send("sheets","POST",{...daily,cashSen:1700},"reopen-save"),
  ]);
  expect(responses.slice(0,2).map(r=>r.status).sort()).toEqual([200,400]);
  expect([201,409]).toContain(responses[2].status);
  expect(await env.BOKLI_DB.prepare("SELECT count(*) FROM month_close_events").first("count(*)")).toBe(2);
  expect((await f.send("sheets","POST",{...daily,cashSen:1700},"reopen-save")).status).toBe(201);
});
it.each(["expense.add","expense.delete","sheet.delete","month.reopen"])("rolls back each batch boundary for %s",async(operation)=>{
  const s=await (await f.send("sheets","POST",daily,"initial-sheet")).json() as any;
  const e=await (await f.send("expenses","POST",expense,"initial-expense")).json() as any;
  if(operation==="month.reopen") await f.send("close","POST",{...close,note:"rent"},"initial-close");
  const path=operation==="sheet.delete"?`sheets?date=${daily.date}&id=${s.sheet.id}&updatedAt=${encodeURIComponent(s.sheet.updatedAt)}`:operation==="month.reopen"?"close/reopen":"expenses";
  const method=operation.endsWith("delete")?"DELETE":"POST";
  const body=operation==="expense.add"?expense:operation==="expense.delete"?{ids:[e.expense.id]}:operation==="month.reopen"?{month:"2026-01",reason:"fault"}:undefined;
  const identity=operation==="month.reopen"?f.admin:f.mom;
  let length=0;
  const count=instrument(env.BOKLI_DB,async(statements)=>{length=statements.length;throw new Error("count only");});
  await f.send(path,method,body,"count",identity,count.binding);
  const before=await records();
  for(let position=0;position<=length;position++) {
    const fault=instrument(env.BOKLI_DB,async(statements,session)=>{const copy=[...statements];copy.splice(position,0,session.prepare("UPDATE cloud_write_guard SET check_code='BOKLI_RESULT_MISSING' WHERE id=1"));return copy;});
    expect((await f.send(path,method,body,`fault-${position}`,identity,fault.binding)).status).toBe(503);
    expect(await records()).toEqual(before);
  }
  console.log("STAGE4_OTHER_FAULT_POSITIONS",JSON.stringify({operation,positions:length+1}));
},120000);
it("rolls back close audit, snapshot and receipt for every batch position",async()=>{
  await f.send("sheets","POST",daily,"first");const before=await records();let count=0;
  const measured=instrument(env.BOKLI_DB,async(s)=>{count=s.length;throw new Error("count");});
  await f.send("close","POST",close,"count",f.mom,measured.binding);
  for(let position=0;position<=count;position++) {
    const faulty=instrument(env.BOKLI_DB,async(s,session)=>{const copy=[...s];copy.splice(position,0,session.prepare("UPDATE cloud_write_guard SET check_code='BOKLI_RESULT_MISSING' WHERE id=1"));return copy;});
    expect((await f.send("close","POST",close,`close-fault-${position}`,f.mom,faulty.binding)).status).toBe(503);
    expect(await records()).toEqual(before);
  }
  console.log("STAGE4_CLOSE_FAULT_POSITIONS",JSON.stringify({positions:count+1,runtimeConstraint:true}));
},120000);
it("refuses a bulk expense deletion spanning locked and open months without partial deletion",async()=>{
  const a=await (await f.send("expenses","POST",expense,"expense-a")).json() as any;
  const b=await (await f.send("expenses","POST",{...expense,month:"2026-02"},"expense-b")).json() as any;
  await f.send("close","POST",{month:"2026-01",cashOnHandSen:0,tngOnHandSen:0,note:"rent",confirmEmpty:true},"close-expense");
  const before=await records();
  expect((await f.send("expenses","DELETE",{ids:[a.expense.id,b.expense.id]},"bulk-locked")).status).toBe(409);
  expect(await records()).toEqual(before);
});
