import { applyD1Migrations, env, fetchMock } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../index";
import { signingKey, token, jwks, seedIdentity } from "./jwt-fixtures";
import { instrument } from "./write-fixtures";
it("measures statements and parameters on actual local Worker/D1 reads at 10x Cost Line volume",async()=>{
  fetchMock.activate();fetchMock.disableNetConnect();
  await applyD1Migrations(env.BOKLI_DB,env.TEST_MIGRATIONS);await seedIdentity();
  const inserts=[];
  for(let day=1;day<=10;day++){
    inserts.push(env.BOKLI_DB.prepare("INSERT INTO daily_sheets(id,date,cash_sen,tng_sen) VALUES (?,?,100,200)").bind(day,`2026-01-${String(day).padStart(2,"0")}`));
    for(let line=0;line<30;line++) inserts.push(env.BOKLI_DB.prepare("INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES (?,1,'gas')").bind(day));
  }
  for(let expense=0;expense<50;expense++) inserts.push(env.BOKLI_DB.prepare("INSERT INTO operating_expenses(month,type,amount_sen,note) VALUES ('2026-01','rental',1,?)").bind(`synthetic-${expense}`));
  await env.BOKLI_DB.batch(inserts);
  const key=await signingKey();const jwt=await token(key);
  const evidence=[];
  for(const [path,statements] of [["identity",1],["dashboard?month=2026-01",4],["expenses?month=2026-01",3],["close?month=2026-01",2],["history",2],["sheets?date=2026-01-01",2],["sheets?date=2026-01-31",2],["dashboard",4],["expenses",3],["close",2]] as const){
    const measured=instrument(env.BOKLI_DB);
    jwks([key]);
    const response=await worker.fetch(new Request(`https://synthetic.invalid/api/cloud-v1/${path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}}),{...env,BOKLI_DB:measured.binding});
    expect(response.status,path).toBe(200);
    const body:any=await response.json();
    if(path.startsWith("dashboard")){expect(body.trend).toHaveLength(10);expect(body.tile.dailyCostSen).toBe(300);expect(body.tile.operatingSen).toBe(50);}
    if(path.startsWith("sheets?date=2026-01-01")) expect(body.data.costLines).toHaveLength(30);
    const queries=measured.queries.map(q=>({bytes:new TextEncoder().encode(q.sql).length,parameters:q.parameters.length,executed:q.executed}));
    expect(queries.reduce((n,q)=>n+q.executed,0),path).toBe(statements);
    expect(Math.max(...queries.map(q=>q.parameters))).toBeLessThanOrEqual(4);
    expect(Math.max(...queries.map(q=>q.bytes))).toBeLessThan(4096);
    evidence.push({path,statements,queries});
  }
  console.log("LOCAL_WORKER_QUERY_METRICS",JSON.stringify({sheets:10,costLines:300,operatingExpenses:50,evidence}));
  fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();
},60000);
