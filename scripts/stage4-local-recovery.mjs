// Local synthetic qualification only. No remote API, credentials, converter or deployment entry point.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { addOperatingExpense,wasOperatingExpenseAddSaved } from "../src/services/operating-expense.ts";
import { reopenMonth,closeMonth } from "../src/services/month-close.ts";

const root=fs.realpathSync(process.cwd());
const parent=path.resolve(root,"data-dev/stage4");
assert.equal(fs.realpathSync(parent),parent,"Refuse symlinked fixture path");
assert.equal(root,"/home/penguin/.t3/worktrees/bokli-dev/cloudflare-migration","Use only the owned isolated worktree");
assert.ok(process.env.BOKLI_DB_PATH && path.resolve(process.env.BOKLI_DB_PATH).startsWith(parent+path.sep),"Explicit resolved stage4 BOKLI_DB_PATH required");
const folder=fs.mkdtempSync(path.join(parent,"sqlite-recovery-"));
const results=[];
try {
  for(const scale of [1,10]) {
    const fixturePath=path.join(parent,`recovery-${scale}.json`);
    assert.equal(fs.realpathSync(fixturePath),fixturePath);
    const {checkpoint}=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
    const file=path.join(folder,`synthetic-${scale}.db`),raw=new Database(file);
    try {
      raw.pragma("foreign_keys=ON");
      raw.transaction(()=>{
        for(const object of checkpoint.schema.filter(o=>o.type==="table")) raw.exec(object.sql);
        for(const [table,rows] of Object.entries(checkpoint.rows).filter(([t])=>t!=="sqlite_sequence")) {
          assert.match(table,/^[a-z_][a-z0-9_]*$/);
          for(const row of rows) {
            for(const column of Object.keys(row)) assert.match(column,/^[a-z_]+$/);
            raw.exec(`INSERT INTO "${table}" (${Object.keys(row).map(k=>`"${k}"`).join(",")}) VALUES (${Object.values(row).join(",")})`);
          }
        }
        raw.exec("DELETE FROM sqlite_sequence");
        for(const row of checkpoint.rows.sqlite_sequence) raw.exec(`INSERT INTO sqlite_sequence(name,seq) VALUES (${row.name},${row.seq})`);
        for(const object of checkpoint.schema.filter(o=>o.type!=="table")) raw.exec(object.sql);
      })();
      const schema=raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY type,name").all();
      assert.deepEqual(schema,checkpoint.schema);
      const rows={};
      for(const table of Object.keys(checkpoint.rows)) {
        const columns=raw.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        rows[table]=raw.prepare(`SELECT ${columns.map(c=>`quote("${c}") AS "${c}"`).join(",")} FROM "${table}" ORDER BY ${columns.map(c=>`"${c}"`).join(",")}`).all();
      }
      assert.deepEqual(rows,checkpoint.rows);
      assert.deepEqual(raw.pragma("foreign_key_check"),[]);assert.equal(raw.pragma("integrity_check",{simple:true}),"ok");
      // Add exactly the native migrator metadata needed for a portable laptop rollback.
      const migrations=readMigrationFiles({migrationsFolder:path.join(root,"drizzle")});
      raw.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
      const insert=raw.prepare('INSERT INTO "__drizzle_migrations"(id,hash,created_at) VALUES (?,?,?)');
      migrations.forEach((m,n)=>insert.run(n+1,m.hash,m.folderMillis));
      const metadata=raw.prepare('SELECT * FROM "__drizzle_migrations" ORDER BY id').all();
      const db=drizzle(raw);
      migrate(db,{migrationsFolder:path.join(root,"drizzle")});
      assert.deepEqual(raw.prepare('SELECT * FROM "__drizzle_migrations" ORDER BY id').all(),metadata);
      assert.equal(await wasOperatingExpenseAddSaved("legacy-0",{db}),true);
      const replay=await addOperatingExpense("2026-01","rental",1200,null,{db,idempotencyKey:"legacy-0"});
      assert.equal(replay.alreadySaved,true);assert.equal(replay.amountSen,1200);
      // Actor-less laptop events stay legal; imported actor history stays immutable.
      await closeMonth("2026-01",1250,0,null,{db});
      assert.equal(raw.prepare("SELECT CAST(MAX(id) AS TEXT) AS id FROM month_close_events").get().id,"9223372036854775807");
      assert.throws(()=>raw.exec("UPDATE month_close_events SET reason='changed'"),/BOKLI_AUDIT_IMMUTABLE/);
      assert.throws(()=>raw.exec("UPDATE operating_expense_add_requests SET result='{}'"),/BOKLI_RECEIPT_IMMUTABLE/);
      assert.throws(()=>raw.exec("DELETE FROM cloud_operation_receipts"),/BOKLI_RECEIPT_IMMUTABLE/);
      // A lowered sequence cannot bypass MAX(rowid); exercise the native service's atomic refusal.
      raw.exec("UPDATE sqlite_sequence SET seq=100 WHERE name='month_close_events'");
      // MAX(rowid) is still int64 max, so the next auto audit correctly refuses overflow.
      await assert.rejects(reopenMonth("2026-01","correct",{db,role:"Admin"}));
      assert.equal(raw.prepare("SELECT reopened_at FROM month_closes WHERE month='2026-01'").get().reopened_at,null);
      results.push({scale,exact:true,schemaObjects:schema.length,rows:Object.values(rows).reduce((n,r)=>n+r.length,0),
        checkpointSha256:crypto.createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex"),migrationHashes:migrations.map(m=>m.hash),
        integrity:"ok",foreignKeys:0,legacyReplay:true,historyImmutable:true,int64SequenceRefusal:true});
    } finally {raw.close();}
  }
  console.log(JSON.stringify({localSqlite:true,nativeRemote:false,results},null,2));
} finally {
  assert.ok(folder.startsWith(parent+path.sep));assert.equal(fs.realpathSync(folder),folder);
  fs.rmSync(folder,{recursive:true});
}
