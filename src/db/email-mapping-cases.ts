import { describe, expect, it } from "vitest";
import type { LockDb } from "./month-lock-cases";

export function emailMappingCases(getDb: () => LockDb) {
  describe("populated additive email mapping migration", () => {
    it("preserves credentials, rows, exact sequence and predecessor guards", async () => {
      const db = getDb();
      await db.baseline();
      await db.run("INSERT INTO users(id,username,password_hash,role) VALUES (7,'synthetic','retained-hash','Operator')");
      await db.run("INSERT INTO daily_sheets(date,cash_sen) VALUES ('2026-01-01',123)");
      await db.run("UPDATE sqlite_sequence SET seq = 9223372036854775806 WHERE name = 'users'");
      await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,note,result) VALUES ('synthetic-retained','2026-01','rental',1,NULL,'{}')");
      await db.run("INSERT INTO month_close_events(month,action,at,reason,snapshot) VALUES ('2026-01','close','synthetic','历史','{}')");
      const receipts = await db.run("SELECT * FROM operating_expense_add_requests");
      const history = await db.run("SELECT * FROM month_close_events");
      const meta = String((await db.run("SELECT name FROM sqlite_master WHERE name IN ('__drizzle_migrations','d1_migrations')"))[0].name);
      const metadata = await db.run(`SELECT * FROM ${meta} ORDER BY id`);
      expect(metadata).toHaveLength(10);
      const users = await db.run("SELECT *, CAST(id AS TEXT) AS exactId FROM users");
      const sequence = await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name != 'd1_migrations' ORDER BY name");
      const objects = await db.run("SELECT name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY name");
      await db.expand();
      expect(await db.run("SELECT *, CAST(id AS TEXT) AS exactId FROM users")).toEqual(users);
      expect(await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name != 'd1_migrations' ORDER BY name")).toEqual(sequence);
      const after = await db.run("SELECT name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY name");
      for (const object of objects) expect(after).toContainEqual(object);
      expect(await db.run("SELECT cash_sen FROM daily_sheets")).toEqual([{cash_sen:123}]);
      expect(await db.run("SELECT * FROM operating_expense_add_requests")).toEqual(receipts);
      expect(await db.run("SELECT * FROM month_close_events")).toEqual(history.map(row=>({...row,actor_user_id:null,actor_role:null})));
      const migratedMetadata = await db.run(`SELECT * FROM ${meta} ORDER BY id`);
      expect(migratedMetadata.slice(0,10)).toEqual(metadata);
      expect(migratedMetadata).toHaveLength(12);
      expect(await db.run("SELECT * FROM user_emails")).toEqual([]);
      await db.run("INSERT INTO user_emails(email,user_id) VALUES (?,?)", "mom@example.invalid", 7);
      expect(await db.run("SELECT u.id,u.role FROM user_emails e JOIN users u ON u.id=e.user_id WHERE e.email=?", "mom@example.invalid")).toEqual([{id:7,role:"Operator"}]);
      await expect(db.run("INSERT INTO user_emails(email,user_id) VALUES (?,?)", "unknown@example.invalid", 99)).rejects.toThrow(/FOREIGN KEY/);
      for (const email of ["MOM@example.invalid", " mom@example.invalid", "mom@example.invalid ", "mo m@example.invalid", "x", "邮件@example.invalid"]) {
        await expect(db.run("INSERT INTO user_emails(email,user_id) VALUES (?,?)", email, 7)).rejects.toThrow(/CHECK/);
      }
      await expect(db.run("INSERT INTO user_emails(email,user_id) VALUES (?,?)", "other@example.invalid", 7)).rejects.toThrow(/UNIQUE/);
      await db.expand();
      expect(await db.run("SELECT * FROM user_emails")).toEqual([{email:"mom@example.invalid",user_id:7}]);
      await db.run("INSERT INTO users(username,password_hash,role) VALUES ('next-synthetic','retained','Operator')");
      expect(await db.run("SELECT CAST(id AS TEXT) AS id FROM users WHERE username='next-synthetic'")).toEqual([{id:"9223372036854775807"}]);
      expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    });
  });
}
