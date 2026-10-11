import { applyD1Migrations, env, fetchMock } from "cloudflare:test";
import worker from "../index";
import { signingKey, token, jwks, seedIdentity } from "./jwt-fixtures";
import type { D1Database, D1DatabaseSession, D1PreparedStatement } from "@cloudflare/workers-types";

export async function writeFixture() {
  fetchMock.activate(); fetchMock.disableNetConnect();
  await applyD1Migrations(env.BOKLI_DB,env.TEST_MIGRATIONS); await seedIdentity();
  const key = await signingKey();
  const mom = await token(key), admin = await token(key,{email:"admin@example.invalid",sub:"synthetic-admin"});
  return {
    mom,admin,key,
    async send(path:string,method="GET",body?:unknown,id?:string,identity=mom,binding=env.BOKLI_DB,extra:Record<string,string>={}) {
      jwks([key]);
      return worker.fetch(new Request(`https://synthetic.invalid/api/cloud-v1/${path}`,{method,
        headers:{"Cf-Access-Jwt-Assertion":identity,Origin:"https://synthetic.invalid","X-Bokli-Api-Generation":"cloud-v1",
          ...(id===undefined?{}:{"Idempotency-Key":id}),...(body===undefined?{}:{"Content-Type":"application/json"}),...extra},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
      }),{...env,BOKLI_DB:binding});
    },
  };
}
export const daily = {date:"2026-01-02",cashSen:1200,tngSen:300,costLines:[{category:"gas",amountSen:250,note:null}]};
export const expense = {month:"2026-01",type:"rental",amountSen:1200,note:null};
export const close = {month:"2026-01",cashOnHandSen:1250,tngOnHandSen:0,note:null};
export const tables = ["users","user_emails","daily_sheets","cost_lines","operating_expenses","month_closes","month_close_events",
  "operating_expense_add_requests","legacy_expense_receipt_owners","cloud_operation_receipts","cloud_write_guard","login_attempts","d1_migrations","sqlite_sequence"];
const recordQueries=new WeakMap<D1Database,string[]>();
export async function records(binding=env.BOKLI_DB) {
  let queries=recordQueries.get(binding);
  if(!queries) {
    queries=[];
    for(const table of tables) {
      const columns=(await binding.prepare(`PRAGMA table_info(${table})`).all<{name:string}>()).results.map(c=>c.name);
      queries.push(`SELECT ${columns.map(c=>`quote("${c}") AS "${c}"`).join(",")} FROM "${table}" ORDER BY ${columns.map(c=>`"${c}"`).join(",")}`);
    }
    recordQueries.set(binding,queries);
  }
  // One read transaction gives an exact snapshot and avoids repeated metadata round trips.
  const results=await binding.batch(queries.map(query=>binding.prepare(query)));
  const rows: Record<string,unknown> = {};
  tables.forEach((table,n)=>{rows[table]=results[n].results;});
  return rows;
}
export interface QueryMetric {sql:string;parameters:unknown[];executed:number;submitted:number}
/** Test-only instrumentation/fault seam forwards to real local D1. Never a runtime route/header/config. */
export function instrument(binding:D1Database, beforeBatch?:(statements:D1PreparedStatement[],session:D1DatabaseSession)=>Promise<D1PreparedStatement[]>, afterBatch?:()=>void) {
  const queries:QueryMetric[]=[];
  const original = new WeakMap<object,D1PreparedStatement>();
  const measured = new WeakMap<object,QueryMetric>();
  function wrap(client:D1Database|D1DatabaseSession):D1Database|D1DatabaseSession {
    return new Proxy(client,{get(target,property) {
      if (property==="withSession" && "withSession" in target) return (constraint:Parameters<D1Database["withSession"]>[0])=>wrap(target.withSession(constraint));
      if (property==="batch") return async (statements:D1PreparedStatement[])=>{
        const raw=statements.map(s=>original.get(s)??s);
        const actual=beforeBatch?await beforeBatch(raw,target as D1DatabaseSession):raw;
        for(const s of statements) measured.get(s)!.submitted++;
        const results=await target.batch(actual);
        for(const s of statements) measured.get(s)!.executed++;
        afterBatch?.(); return results;
      };
      if (property!=="prepare") {const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;}
      return (query:string)=>{
        const metric:QueryMetric={sql:query,parameters:[],executed:0,submitted:0};queries.push(metric);
        const statement=(raw:D1PreparedStatement):D1PreparedStatement=>{
          const proxy=new Proxy(raw,{get(t,p){
            if(p==="__metric") return metric;
            if(p==="bind") return (...args:unknown[])=>{metric.parameters=args;return statement(t.bind(...args));};
            const value=Reflect.get(t,p,t);
            if(typeof value!=="function") return value;
            return (...args:unknown[])=>{if(["all","first","run","raw"].includes(String(p))) {metric.executed++;metric.submitted++;}return value.apply(t,args);};
          }});original.set(proxy,raw);measured.set(proxy,metric);return proxy;
        };
        return statement(target.prepare(query));
      };
    }});
  }
  return {binding:wrap(binding) as D1Database,queries};
}
