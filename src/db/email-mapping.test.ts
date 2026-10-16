import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach } from "vitest";
import { emailMappingCases } from "./email-mapping-cases";
const parent = path.resolve("data-dev/stage4");
fs.mkdirSync(parent,{recursive:true});
if (fs.realpathSync(parent) !== parent) throw new Error("Synthetic migration path must resolve inside data-dev");
const root = fs.mkdtempSync(path.join(parent,"email-mapping-"));
const baseline = path.join(root,"baseline");
fs.mkdirSync(path.join(baseline,"meta"),{recursive:true});
const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf8"));
journal.entries = journal.entries.slice(0,10);
fs.writeFileSync(path.join(baseline,"meta/_journal.json"),JSON.stringify(journal));
for (const entry of journal.entries) fs.copyFileSync(`drizzle/${entry.tag}.sql`,path.join(baseline,`${entry.tag}.sql`));
let raw: Database.Database;
beforeEach(()=> { raw = new Database(path.join(root,"synthetic.db")); raw.pragma("foreign_keys = ON"); });
afterEach(()=>raw.close());
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
emailMappingCases(()=>({
  async run(sql,...values){ const s=raw.prepare(sql); if(s.reader) return s.all(...values) as any; s.run(...values);return []; },
  async batch(statements){raw.transaction(()=>statements.forEach(s=>raw.exec(s)))();},
  async baseline(){migrate(drizzle(raw),{migrationsFolder:baseline});},
  async expand(){migrate(drizzle(raw),{migrationsFolder:"drizzle"});},
}));
