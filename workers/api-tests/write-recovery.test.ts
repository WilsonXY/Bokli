import { env,fetchMock } from "cloudflare:test";
import { expect,it } from "vitest";
import { writeFixture,daily,expense,close,records,tables } from "./write-fixtures";
import type { D1Database } from "@cloudflare/workers-types";

async function image(db:D1Database) {
  const schema=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY type,name").all<{type:string;name:string;tbl_name:string;sql:string}>()).results;
  return {schema,rows:await records(db)};
}
async function digest(value:unknown) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
it.each([1,10])("recovers actual consuming schema, records and behavior at %sx volume",async(scale)=>{
  const f=await writeFixture();
  try {
    // The saved examples come from real consumers, not projected schema placeholders.
    await f.send("sheets","POST",daily,"actual-sheet");
    const add=await (await f.send("expenses","POST",expense,"actual-expense")).json() as any;
    await f.send("expenses","DELETE",{ids:[add.expense.id]},"actual-delete");
    const removable=await (await f.send("sheets","POST",{...daily,date:"2026-02-02"},"actual-sheet-before-delete")).json() as any;
    await f.send(`sheets?date=2026-02-02&id=${removable.sheet.id}&updatedAt=${encodeURIComponent(removable.sheet.updatedAt)}`,"DELETE",undefined,"actual-sheet-delete");
    await f.send("close","POST",close,"actual-close");
    await f.send("close/reopen","POST",{month:"2026-01",reason:"fixture"},"actual-reopen",f.admin);
    const templates=(await env.BOKLI_DB.prepare("SELECT actor_user_id,operation,payload,status,result FROM cloud_operation_receipts ORDER BY operation").all()).results;
    const seed=[];
    for(let n=0;n<100*scale;n++) {
      // 10x spans years while remaining historical, with 30 Cost Lines on every sheet.
      const year=2025-Math.floor(n/(28*12)), month=Math.floor(n/28)%12+1;
      const date=`${year}-${String(month).padStart(2,"0")}-${String(n%28+1).padStart(2,"0")}`;
      seed.push(env.BOKLI_DB.prepare("INSERT INTO daily_sheets(id,date,cash_sen,tng_sen,note) VALUES (?,?,12345,678,'合成')").bind(n+100,date));
      for(let line=0;line<30;line++) seed.push(env.BOKLI_DB.prepare("INSERT INTO cost_lines(daily_sheet_id,amount_sen,category,note) VALUES (?,?,'gas',?)").bind(n+100,line+1,`synthetic-${line}`));
    }
    for(let n=0;n<150*scale;n++) {
      seed.push(env.BOKLI_DB.prepare("INSERT INTO operating_expenses(month,type,amount_sen,note) VALUES ('2024-01','rental',?,?)").bind(n+1,`expense-${n}`));
      seed.push(env.BOKLI_DB.prepare("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,note,result) VALUES (?,'2026-01','rental',1200,NULL,?)").bind(`legacy-${n}`,JSON.stringify(add.expense)));
      seed.push(env.BOKLI_DB.prepare("INSERT INTO legacy_expense_receipt_owners VALUES (?,1)").bind(`legacy-${n}`));
    }
    for(let n=0;n<900*scale;n++) {
      const t=templates[n%templates.length];
      seed.push(env.BOKLI_DB.prepare("INSERT INTO cloud_operation_receipts(actor_user_id,operation,operation_id,payload,attempt_token,status,result) VALUES (?,?,?,?,?,?,?)")
        .bind(t.actor_user_id,t.operation,`synthetic-history-${n}`,t.payload,`committed-${n}`,t.status,t.result));
    }
    // Seeding is test fixture setup; application writes above are never split.
    for(let offset=0;offset<seed.length;offset+=50) await env.BOKLI_DB.batch(seed.slice(offset,offset+50));
    seed.length=0;
    for(let n=0;n<8*scale;n++) {
      expect((await f.send("close","POST",close,`audit-close-${n}`)).status).toBe(201);
      expect((await f.send("close/reopen","POST",{month:"2026-01",reason:`audit-${n}`},`audit-open-${n}`,f.admin)).status).toBe(200);
    }
    await env.BOKLI_DB.prepare("UPDATE sqlite_sequence SET seq=9223372036854775806 WHERE name='month_close_events'").run();
    await env.BOKLI_DB.prepare("UPDATE cloud_write_guard SET maintenance=1 WHERE id=1").run();
    const checkpoint=await image(env.BOKLI_DB);
    // A valid later write is preserved separately, then deliberately absent in the restored checkpoint.
    await env.BOKLI_DB.prepare("UPDATE cloud_write_guard SET maintenance=0 WHERE id=1").run();
    const later={...daily,date:"2026-02-03",cashSen:9999};
    const laterResponse=await f.send("sheets","POST",later,"later-valid");expect(laterResponse.status).toBe(201);
    const laterSaved=await laterResponse.json() as any;
    const laterEdited=await (await f.send("sheets","POST",{...daily,cashSen:2300},"later-edit")).json() as any;
    const laterImage=await image(env.BOKLI_DB),laterSha256=await digest(laterImage);
    const restored=env.BOKLI_RECOVERY_DB;
    for(const object of checkpoint.schema.filter(s=>s.type==="table")) await restored.prepare(object.sql).run();
    for(const table of tables.filter(t=>t!=="sqlite_sequence")) {
      const rows=checkpoint.rows[table] as Record<string,string>[];
      for(let offset=0;offset<rows.length;offset+=50) await restored.batch(rows.slice(offset,offset+50).map(row=>
        restored.prepare(`INSERT INTO "${table}" (${Object.keys(row).map(k=>`"${k}"`).join(",")}) VALUES (${Object.values(row).join(",")})`)));
    }
    await restored.prepare("DELETE FROM sqlite_sequence").run();
    for(const row of checkpoint.rows.sqlite_sequence as Record<string,string>[]) await restored.prepare(`INSERT INTO sqlite_sequence(name,seq) VALUES (${row.name},${row.seq})`).run();
    for(const object of checkpoint.schema.filter(s=>s.type!=="table")) await restored.prepare(object.sql).run();
    expect(await image(restored)).toEqual(checkpoint);
    expect((await restored.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect(await restored.prepare("PRAGMA quick_check").first("quick_check")).toBe("ok");
    expect(await (await f.send("expenses?idempotencyKey=actual-expense","GET",undefined,undefined,f.mom,restored)).json()).toMatchObject({saved:true,result:{expense:{amountSen:1200}}});
    expect(await (await f.send("expenses?idempotencyKey=actual-expense","GET",undefined,undefined,f.admin,restored)).json()).toEqual({saved:false});
    expect((await f.send("sheets","POST",later,"later-valid",f.mom,restored)).status).toBe(503);
    await restored.prepare("UPDATE cloud_write_guard SET maintenance=0 WHERE id=1").run();
    expect((await f.send(`sheets?date=${daily.date}&id=${laterEdited.sheet.id}&updatedAt=${encodeURIComponent(laterEdited.sheet.updatedAt)}`,"DELETE",undefined,"stale-restored-client",f.mom,restored)).status).toBe(409);
    await restored.prepare("UPDATE cloud_write_guard SET maintenance=1 WHERE id=1").run();
    // Reconcile only the two verified later commits, preserving their served receipts/results/timestamps.
    // The gate opens and closes inside this ONE transaction; no external cloud writer can enter between them.
    const quoteInsert=(table:string,row:Record<string,string>)=>`INSERT INTO "${table}" (${Object.keys(row).map(k=>`"${k}"`).join(",")}) VALUES (${Object.values(row).join(",")})`;
    const sheetIds=[String(laterSaved.sheet.id),String(laterEdited.sheet.id)];
    const laterSheets=(laterImage.rows.daily_sheets as Record<string,string>[]).filter(row=>sheetIds.includes(row.id));
    const laterLines=(laterImage.rows.cost_lines as Record<string,string>[]).filter(row=>sheetIds.includes(row.daily_sheet_id));
    const laterReceipts=(laterImage.rows.cloud_operation_receipts as Record<string,string>[]).filter(row=>["'later-valid'","'later-edit'"].includes(row.operation_id));
    expect(laterSheets).toHaveLength(2);expect(laterLines).toHaveLength(2);expect(laterReceipts).toHaveLength(2);
    const reconciliation=[restored.prepare("UPDATE cloud_write_guard SET maintenance=0 WHERE id=1"),
      ...laterSheets.map(row=>restored.prepare(quoteInsert("daily_sheets",row)+" ON CONFLICT(id) DO UPDATE SET "+Object.keys(row).filter(k=>k!=="id").map(k=>`"${k}"=excluded."${k}"`).join(","))),
      restored.prepare("DELETE FROM cost_lines WHERE daily_sheet_id IN (?,?)").bind(...sheetIds),
      ...laterLines.map(row=>restored.prepare(quoteInsert("cost_lines",row))),
      ...laterReceipts.map(row=>restored.prepare(quoteInsert("cloud_operation_receipts",row))),
      ...(laterImage.rows.sqlite_sequence as Record<string,string>[]).map(row=>restored.prepare(`UPDATE sqlite_sequence SET seq=${row.seq} WHERE name=${row.name}`)),
      restored.prepare("UPDATE cloud_write_guard SET maintenance=1 WHERE id=1"),
    ];
    const beforeReconcile=await image(restored),failed=[...reconciliation];
    failed.splice(Math.floor(failed.length/2),0,restored.prepare("UPDATE cloud_write_guard SET check_code='BOKLI_RESULT_MISSING' WHERE id=1"));
    await expect(restored.batch(failed)).rejects.toThrow("BOKLI_RESULT_MISSING");expect(await image(restored)).toEqual(beforeReconcile);
    await restored.batch(reconciliation);
    const expectedLater=structuredClone(laterImage);
    (expectedLater.rows.cloud_write_guard as Record<string,string>[])[0].maintenance="1";
    expect(await image(restored)).toEqual(expectedLater);
    const replay=await f.send("sheets","POST",later,"later-valid",f.mom,restored);expect(replay.status).toBe(201);expect(await replay.json()).toEqual(laterSaved);
    expect(await (await f.send("sheets","POST",{...daily,cashSen:2300},"later-edit",f.mom,restored)).json()).toEqual(laterEdited);
    expect(await image(restored)).toEqual(expectedLater);
    await restored.prepare("UPDATE cloud_write_guard SET maintenance=0 WHERE id=1").run();
    expect((await f.send("close","POST",{...close,note:"reconcile later valid write"},"after-recovery-close",f.mom,restored)).status).toBe(201);
    expect(await restored.prepare("SELECT CAST(MAX(id) AS TEXT) AS id FROM month_close_events").first("id")).toBe("9223372036854775807");
    expect((await f.send("sheets","POST",daily,"locked-after-restore",f.mom,restored)).status).toBe(409);
    console.log("STAGE4_RECOVERY_SUMMARY",JSON.stringify({scale,schemaObjects:checkpoint.schema.length,rowCounts:Object.fromEntries(Object.entries(checkpoint.rows).map(([k,v])=>[k,(v as unknown[]).length])),checkpointSha256:await digest(checkpoint),laterSha256,localD1Exact:true,laterReconciliationExact:true,reconciliationStatements:reconciliation.length,nativeRemote:false}));
    // Bound full portable synthetic image, used by the throwaway SQLite comparison below.
    const compressed=await new Response(new Blob([JSON.stringify({scale,checkpoint,later:laterImage})]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const bytes=new Uint8Array(compressed);
    let binary="";for(let offset=0;offset<bytes.length;offset+=8192) binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    const serialized=btoa(binary);
    const chunkSize=32*1024, total=Math.ceil(serialized.length/chunkSize);
    for(let index=0;index<total;index++) console.log("STAGE4_RECOVERY_CHUNK",JSON.stringify({scale,index,total,encoding:"gzip-base64",text:serialized.slice(index*chunkSize,(index+1)*chunkSize)}));
  } finally {fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();}
},300000);
