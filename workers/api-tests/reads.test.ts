import { applyD1Migrations, env, SELF, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, afterEach, expect, it,vi } from "vitest";
import worker from "../index";
import { getTodayInKualaLumpur } from "../../src/lib/datetime";
import { signingKey, token, jwks, seedIdentity, type SigningKey } from "./jwt-fixtures";
let key: SigningKey;
beforeAll(async()=>{key=await signingKey();});
beforeEach(async()=>{fetchMock.activate();fetchMock.disableNetConnect();await applyD1Migrations(env.BOKLI_DB,env.TEST_MIGRATIONS);await seedIdentity();});
afterEach(()=>{vi.useRealTimers();fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
it("loads an absent Daily Sheet as null through the real Worker and D1",async()=>{
  jwks([key]);
  const jwt=await token(key);
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/sheets?date=2026-01-02",{headers:{"Cf-Access-Jwt-Assertion":jwt}});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({date:"2026-01-02",todayKl:getTodayInKualaLumpur(),isClosed:false,data:null});
});

const cases = JSON.parse(env.TEST_READ_CASES) as import("./legacy-reference").ReferenceCase[];
for (const fixture of cases) {
  it(`matches current SQLite page consumers: ${fixture.name}`,async()=>{
    // Anchor both real service implementations to the reference's captured clock, including midnight.
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(cases[0].referenceNow!));
    for (const statement of fixture.sql) await env.BOKLI_DB.prepare(statement).run();
    const jwt=await token(key);
    for (const read of fixture.reads) {
      jwks([key]);
      const response=await worker.fetch(new Request(`https://synthetic.invalid/api/cloud-v1/${read.path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}}),env);
      expect({path:read.path,status:response.status}).toEqual({path:read.path,status:200});
      expect(await response.json(),read.path).toEqual(read.expected);
    }
  },60000);
}
it("rejects duplicate, unknown and oversized query parameters",async()=>{
  const jwt=await token(key);
  for(const path of ["dashboard?month=2026-01&month=2026-02","sheets?date=2026-01-02&date=2026-01-03","identity?email=admin@example.invalid","history?role=Admin","expenses?month="+"x".repeat(11),"close?sql=DROP"]){
    jwks([key]);
    expect((await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}})).status,path).toBe(400);
  }
});
it("returns the exact safe-limit total including the missing-current-month fallback",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES ('2026-01-02',9007199254740991,0)").run();
  const jwt=await token(key);
  for(const path of ["dashboard?month=2026-01","expenses?month=2026-01","close?month=2026-01","sheets?date=2026-01-02"]){
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status,path).toBe(200);
    const body:any=await response.json();
    expect(body.tile?.revenueSen??body.summary?.revenueSen??body.financials?.revenueSen??body.data?.totalRevenueSen).toBe(9007199254740991);
  }
  jwks([key]);
  const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/dashboard?month=${getTodayInKualaLumpur().slice(0,7)}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
  expect(response.status).toBe(200);
  expect((await response.json() as any).tile.revenueSen).toBe(0);
});
it.each([
  ["individual outside safe range",["INSERT INTO daily_sheets(date,cash_sen) VALUES ('2026-01-02',9007199254740992)"]],
  ["individual int64 maximum",["INSERT INTO daily_sheets(date,cash_sen) VALUES ('2026-01-02',9223372036854775807)"]],
  ["cash aggregate",["INSERT INTO daily_sheets(date,cash_sen) VALUES ('2026-01-02',9007199254740991),('2026-01-03',1)"]],
  ["cash plus TnG component",["INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES ('2026-01-02',9007199254740991,1)"]],
  ["cancellation cannot hide revenue overflow",["INSERT INTO daily_sheets(id,date,cash_sen,tng_sen) VALUES (1,'2026-01-02',9007199254740991,1)","INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES (1,1,'gas')"]],
  ["aggregate int64 overflow",["INSERT INTO daily_sheets(date,cash_sen) VALUES ('2026-01-02',9223372036854775807),('2026-01-03',1)"]],
  ["cost aggregate",["INSERT INTO daily_sheets(id,date) VALUES (1,'2026-01-02')","INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES (1,9007199254740991,'gas'),(1,1,'restock')"]],
  ["expense aggregate",["INSERT INTO operating_expenses(month,type,amount_sen) VALUES ('2026-01','rental',9007199254740991),('2026-01','utilities',1)"]],
  ["intermediate/final negative profit",["INSERT INTO daily_sheets(id,date) VALUES (1,'2026-01-02')","INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES (1,9007199254740991,'gas')","INSERT INTO operating_expenses(month,type,amount_sen) VALUES ('2026-01','rental',1)"]],
])("refuses precise money error: %s",async(_name,statements)=>{
  for(const statement of statements) await env.BOKLI_DB.prepare(statement).run();
  const jwt=await token(key);
  for(const page of ["dashboard","expenses","close"]) {
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${page}?month=2026-01`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status,page).toBe(422);
    expect(await response.json()).toEqual({code:"moneyRange"});
  }
  jwks([key]);
  const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/dashboard?month=${getTodayInKualaLumpur().slice(0,7)}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
  expect(response.status,"missing-month selector still checks existing money").toBe(422);
});
it.each([
  ["snapshot", "9007199254740992,0,0,0,0,0,0"],
  ["on-hand sum", "0,0,0,0,0,9007199254740991,1"],
  ["difference intermediate", "0,0,0,0,-9007199254740991,1,0"],
])("rejects Month Close %s overflow",async(_name,values)=>{
  await env.BOKLI_DB.prepare(`INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,cash_on_hand_sen,tng_on_hand_sen) VALUES ('2026-01',${values})`).run();
  const jwt=await token(key);
  for(const path of ["dashboard?month=2026-01","close?month=2026-01","history"]){
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status,path).toBe(422);
  }
});
it("never rounds an unsafe ID or an individual Daily Sheet amount",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO daily_sheets(id,date,cash_sen) VALUES (9007199254740992,'2026-01-02',1),(2,'2026-01-03',9007199254740992),(3,'2026-01-04',9007199254740991)").run();
  await env.BOKLI_DB.prepare("INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES (3,9007199254740991,'gas'),(3,1,'restock')").run();
  const jwt=await token(key);
  for(const date of ["2026-01-02","2026-01-03","2026-01-04"]){
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/sheets?date=${date}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status).toBe(422);
  }
});
