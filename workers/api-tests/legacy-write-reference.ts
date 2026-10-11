// Node-only retained SQLite business reference; no application database is opened.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sheet from "../../src/services/daily-sheet";
import { addOperatingExpense,deleteOperatingExpenses,type OperatingExpenseType } from "../../src/services/operating-expense";
import { closeMonth,reopenMonth } from "../../src/services/month-close";
import { handleError } from "../../src/services/errors";
import * as schema from "../../src/db/schema";
type Body={date?:string;cashSen?:number;tngSen?:number;costLines?:sheet.ReplaceCostLineInput[];month?:string;type?:OperatingExpenseType;amountSen?:number;note?:string|null;ids?:number[];reason?:string;confirmEmpty?:boolean;cashOnHandSen?:number;tngOnHandSen?:number};
export interface WriteReference {path:string;method:string;body?:Body;key:string;admin?:boolean;status:number;expected:unknown}
export async function legacyWriteReference():Promise<WriteReference[]> {
  const raw=new Database(":memory:");raw.pragma("foreign_keys=ON");
  const db=drizzle(raw,{schema});migrate(db,{migrationsFolder:"drizzle"});
  const result:WriteReference[]=[];
  const steps={
    sheet:{date:"2026-01-02",cashSen:1200,tngSen:300,costLines:[{category:"gas",amountSen:100,note:" "},{category:"gas",amountSen:150,note:null},{category:"other",amountSen:50,note:" 汤 🥣 "}]},
    expense:{month:"2026-01",type:"rental" as const,amountSen:100,note:null},
    close:{month:"2026-01",cashOnHandSen:0,tngOnHandSen:0,note:" 对账 "},
  };
  async function run(path:string,method:string,body:Body|undefined,key:string,admin=false) {
    let response:Response;
    try {
      let value:unknown,status=200;
      if(path==="sheets" && method==="POST") {
        db.transaction(tx=>{const current=sheet.getOrCreateSheet(body!.date!,{db:tx});
          if(body!.cashSen!==undefined||body!.tngSen!==undefined) sheet.setRevenue(current.id,body!.cashSen??current.cashSen,body!.tngSen??current.tngSen,{db:tx});
          sheet.replaceCostLines(current.id,body!.costLines!,{db:tx});});
        value=sheet.getSheetWithCosts(body!.date!,{db});status=201;
      } else if(path==="sheet-delete") {
        const current=sheet.getSheetByDate("2026-01-02",{db})!;
        sheet.deleteSheet(current.id,{id:current.id,updatedAt:current.updatedAt},{db});value={deleted:true,date:current.date};
      } else if(path==="expenses"&&method==="POST") {
        const expense=await addOperatingExpense(body!.month!,body!.type!,body!.amountSen!,body!.note,{db,idempotencyKey:key});
        value={expense,merged:expense.merged,alreadySaved:expense.alreadySaved};status=expense.merged||expense.alreadySaved?200:201;
      } else if(path==="expenses") value=await deleteOperatingExpenses(body!.ids!,{db});
      else if(path==="close") {
        const {balanced,differenceSen,expectedSen,actualSen,warning,...close}=await closeMonth(body!.month!,body!.cashOnHandSen!,body!.tngOnHandSen!,body!.note,{db,confirmEmpty:Boolean(body!.confirmEmpty)});
        value={close,balanced,differenceSen,expectedSen,actualSen,...(warning?{warning}:{})};status=201;
      } else value={close:await reopenMonth(body!.month!,body!.reason!,{db,role:admin?"Admin":"Operator"}),message:`Month "${body!.month}" successfully reopened`};
      response=Response.json(JSON.parse(JSON.stringify(value,(_,v)=>typeof v==="bigint"?Number(v):v)),{status});
    } catch(error) {response=handleError(error);}
    result.push({path,method,body,key,admin,status:response.status,expected:await response.json()});
  }
  try {
    await run("sheets","POST",steps.sheet,"save");
    await run("sheets","POST",{date:steps.sheet.date,costLines:[]},"replace-costs");
    await run("sheets","POST",steps.sheet,"replace-all");
    await run("expenses","POST",steps.expense,"add");
    await run("expenses","POST",steps.expense,"merge");
    await run("expenses","POST",steps.expense,"add");
    await run("expenses","DELETE",{ids:[1,999]},"delete-expenses");
    await run("close","POST",steps.close,"close");
    await run("sheets","POST",steps.sheet,"locked");
    await run("expenses","POST",steps.expense,"add");
    await run("close/reopen","POST",{month:"2026-01",reason:" 核查 "},"operator-reopen");
    await run("close/reopen","POST",{month:"2026-01",reason:" 核查 "},"admin-reopen",true);
    await run("sheet-delete","DELETE",undefined,"delete-sheet");
    await run("close","POST",{...steps.close,cashOnHandSen:0,tngOnHandSen:0,note:null,confirmEmpty:true},"reclose");
    return result;
  } finally {raw.close();}
}
