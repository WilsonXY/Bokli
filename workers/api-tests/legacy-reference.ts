// Node-only reference: current retained SQLite services, synthetic fixtures, no application DB.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDashboard, listMonthTiles } from "../../src/services/dashboard";
import { getSheetWithCosts, isMonthClosed } from "../../src/services/daily-sheet";
import { getMonthPreview, listOperatingExpenses } from "../../src/services/operating-expense";
import { getClose, listCloses } from "../../src/services/month-close";
import { resolveActiveMonthView } from "../../src/lib/months";
import { getTodayInKualaLumpur } from "../../src/lib/datetime";
import { isValidDateStr } from "../../src/lib/money";
import * as schema from "../../src/db/schema";
export interface ReferenceCase {name:string;sql:string[];reads:{path:string;expected:unknown}[]}
const normal = [
  "INSERT INTO daily_sheets(id,date,cash_sen,tng_sen,note) VALUES (2,'2026-01-02',1000,200,NULL),(1,'2026-01-01',300,400,'汤 🥣'),(3,'2025-12-31',50,0,NULL),(4,'2026-02-01',0,0,NULL)",
  "INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category,note) VALUES (9,2,90,'other','修理'),(8,2,80,'maintenance',NULL),(7,2,70,'wages-daily',NULL),(6,2,60,'transport',NULL),(5,2,50,'gas',NULL),(4,2,40,'restock',NULL),(3,1,30,'gas',''),(2,3,20,'restock',NULL)",
  "INSERT INTO operating_expenses(id,month,type,amount_sen,note) VALUES (3,'2026-01','other',30,'杂费 🐈'),(2,'2026-01','utilities',20,''),(1,'2026-01','rental',10,NULL)",
];
const close = (reopened=false)=> `INSERT INTO month_closes(id,month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,cash_on_hand_sen,tng_on_hand_sen,note,reopened_at,reopen_reason) VALUES (1,'2026-01',9000,1000,8000,2000,6000,NULL,NULL,'旧账',${reopened?"'2026-02-01 00:00:00'":"NULL"},${reopened?"'重新检查'":"NULL"})`;
const fixtures = [
  {name:"empty",sql:[]},
  {name:"normal",sql:normal},
  {name:"numeric-order",sql:[...normal,"INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES (10,2,10,'gas')","INSERT INTO operating_expenses(id,month,type,amount_sen,note) VALUES (10,'2026-01','rental',10,'digit-boundary')"]},
  {name:"expense-only",sql:["INSERT INTO operating_expenses(month,type,amount_sen,note) VALUES ('2026-01','rental',100,NULL)"]},
  {name:"close-only",sql:[close()]},
  {name:"closed",sql:[...normal,close()]},
  {name:"reopened",sql:[...normal,close(true)]},
  {name:"missing-current-month",sql:["INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES ('2025-12-31',1,2)"]},
  {name:"leap-boundary",sql:["INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES ('2024-02-29',5,6),('2024-03-01',7,8)"]},
];
async function main() {
const result: ReferenceCase[]=[];
for (const fixture of fixtures) {
  const raw=new Database(":memory:");raw.pragma("foreign_keys=ON");
  const db=drizzle(raw,{schema});migrate(db,{migrationsFolder:"drizzle"});
  try {
    const timedSql = fixture.sql.flatMap(statement=> {
      const table = /^INSERT INTO (daily_sheets|cost_lines|operating_expenses|month_closes)/.exec(statement)?.[1];
      const timestamp = "2026-01-02 03:04:05";
      if (!table) return [statement];
      const fields = table === "month_closes" ? `closed_at='${timestamp}'` : table === "cost_lines" ? `created_at='${timestamp}'` : `created_at='${timestamp}',updated_at='${timestamp}'`;
      return [statement,`UPDATE ${table} SET ${fields}`];
    });
    for(const statement of timedSql) raw.exec(statement);
    const todayKl=getTodayInKualaLumpur();const current=todayKl.slice(0,7);
    const tiles=await listMonthTiles({db,upToMonth:current});
    const reads: ReferenceCase["reads"]=[];
    for (const requested of [undefined,"2026-01","2026-02","invalid","2099-12","2025-12","2024-02"]) {
      const view=resolveActiveMonthView(requested,tiles,current);
      const month=view.activeMonth;
      const dashboard=await getDashboard(month,{db});
      const effectiveTiles=tiles.some(t=>t.month===month)?tiles:[dashboard.tile,...tiles];
      const query=requested===undefined?"":`?month=${requested}`;
      reads.push({path:`dashboard${query}`,expected:{...dashboard,activeMonth:month,tiles:effectiveTiles}});
      const summary=await getMonthPreview(month,{db});
      reads.push({path:`expenses${query}`,expected:{...view,expenses:await listOperatingExpenses(month,{db}),summary,isClosed:isMonthClosed(month,db)}});
      reads.push({path:`close${query}`,expected:{...view,financials:summary,closeRecord:await getClose(month,{db}),hasSheetsInMonth:(raw.prepare("SELECT count(*) AS n FROM daily_sheets WHERE date LIKE ?").get(`${month}-%`) as {n:number}).n > 0,userRole:"Operator"}});
    }
    for(const requested of [undefined,"2026-01-02","2026-01-01","2025-12-31","2026-02-01","2024-02-29","2099-12-31","invalid"]) {
      const date=requested&&isValidDateStr(requested)&&requested<=todayKl?requested:todayKl;
      reads.push({path:`sheets${requested?`?date=${requested}`:""}`,expected:{date,todayKl,isClosed:isMonthClosed(date.slice(0,7),db),data:getSheetWithCosts(date,{db})}});
    }
    reads.push({path:"history",expected:await listCloses({db})});
    result.push({...fixture,sql:timedSql,reads});
  } finally {raw.close();}
}
process.stdout.write(JSON.stringify(result,(_,value)=>typeof value==="bigint"?Number(value):value));

}
void main();
