import { env,fetchMock } from "cloudflare:test";
import { beforeEach,afterEach,expect,it } from "vitest";
import type { D1Database,D1PreparedStatement } from "@cloudflare/workers-types";
import { writeFixture,daily,expense } from "./write-fixtures";
let f:Awaited<ReturnType<typeof writeFixture>>;
beforeEach(async()=>{f=await writeFixture();});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
// A real committed mutation between independent SELECTs reproduces mixed-version reads.
function betweenReads(pattern:RegExp,change:()=>Promise<void>) {
  let changed=false;
  const original=new WeakMap<object,D1PreparedStatement>();
  const binding=new Proxy(env.BOKLI_DB,{get(target,property){
    if(property==="batch") return async(statements:D1PreparedStatement[])=>{
      const result=await target.batch(statements.map(s=>original.get(s)??s));
      if(!changed){changed=true;await change();}return result;
    };
    if(property!=="prepare") {const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;}
    return (query:string)=>{
      const wrap=(raw:D1PreparedStatement):D1PreparedStatement=>{const proxy=new Proxy(raw,{get(t,p){
        if(p==="bind") return (...args:unknown[])=>wrap(t.bind(...args));
        if(p==="all") return async(...args:unknown[])=>{const result=await t.all(...args as []);if(!changed&&pattern.test(query)){changed=true;await change();}return result;};
        const value=Reflect.get(t,p,t);return typeof value==="function"?value.bind(t):value;
      }});original.set(proxy,raw);return proxy;};
      return wrap(target.prepare(query));
    };
  }});
  return {binding:binding as D1Database,get changed(){return changed;}};
}
it("returns one complete Daily Sheet version during a concurrent replacement",async()=>{
  await f.send("sheets","POST",daily,"old");
  const race=betweenReads(/FROM \(SELECT .* AS date\)/s,async()=>{expect((await f.send("sheets","POST",{...daily,cashSen:2000,costLines:[{category:"gas",amountSen:700,note:null}]},"new")).status).toBe(201);});
  const reply=await f.send("sheets?date=2026-01-02","GET",undefined,undefined,f.mom,race.binding);
  expect(reply.status).toBe(200);const {data}=await reply.json() as any;
  expect([[1200,250],[2000,700]]).toContainEqual([data.sheet.cashSen,data.totalCostSen]);
  expect(race.changed).toBe(true);expect(data.grossProfitSen).toBe(data.sheet.cashSen+300-data.totalCostSen);
});
it.each(["expenses","dashboard"])("keeps %s totals and detail rows from the same committed snapshot",async(page)=>{
  await f.send("sheets","POST",daily,"sheet");await f.send("expenses","POST",expense,"expense");
  const race=betweenReads(/WITH sheets AS/,async()=>{
    const route=page==="expenses"?"expenses":"sheets",body=page==="expenses"?expense:{...daily,cashSen:2000,costLines:[{category:"gas",amountSen:700,note:null}]};
    expect([200,201]).toContain((await f.send(route,"POST",body,"changed")).status);
  });
  const response=await f.send(`${page}?month=2026-01`,"GET",undefined,undefined,f.mom,race.binding);expect(response.status).toBe(200);
  const body=await response.json() as any;
  expect(race.changed).toBe(true);
  if(page==="expenses") expect(body.summary.operatingSen).toBe(body.expenses.reduce((n:number,e:any)=>n+e.amountSen,0));
  else {expect(body.tile.revenueSen).toBe(body.trend.reduce((n:number,e:any)=>n+e.totalSen,0));expect(body.tile.dailyCostSen).toBe(Object.values(body.costByCategory).reduce((n:any,v:any)=>n+v,0));}
});
