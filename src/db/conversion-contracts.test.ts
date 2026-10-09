import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { beforeEach, expect, it } from "vitest";
import { assertExpansionBoundary, assertPinnedArtifacts, reverseForLegacy, type DatabaseImage } from "./conversion-contracts";
import { captureFixture, fixtureRestoreStatements } from "./image-fixtures";
import type { ContractDb } from "./contract-cases";

let frozen: DatabaseImage;
let expanded: DatabaseImage;
beforeEach(async () => {
  const sqlite = new Database(":memory:");
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  const db = { async run(sql: string, ...values: (string | number | null)[]) {
    const statement = sqlite.prepare(sql);
    if (statement.reader) return statement.all(...values);
    statement.run(...values); return [];
  } } as ContractDb;
  try {
    sqlite.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    for (const [i, migration] of migrations.entries()) {
      for (const sql of migration.sql) sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(migration.hash, migration.folderMillis);
      if (i === 8) {
        sqlite.exec("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','fixture-only','Operator'); INSERT INTO daily_sheets(id,date,note) VALUES(1,'2025-01-01',NULL); UPDATE sqlite_sequence SET seq=100 WHERE name='users'");
        frozen = await captureFixture(db);
      }
    }
    sqlite.exec("INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','fixture-op','{}',200,'{}'); UPDATE sqlite_sequence SET seq=200 WHERE name='users'");
    expanded = await captureFixture(db);
  } finally { sqlite.close(); }
});

it("projects the frozen schema and credentials while preserving new receipts and metadata in a private sidecar", async () => {
  expanded.tables.find(t => t.name === "users")!.rows[0].password_hash = null;
  const result = await reverseForLegacy(expanded, frozen);
  expect(result.legacy.tables.find(t => t.name === "users")!.rows).toEqual(frozen.tables.find(t => t.name === "users")!.rows);
  expect(result.legacy.tables.find(t => t.name === "__drizzle_migrations")).toEqual(frozen.tables.find(t => t.name === "__drizzle_migrations"));
  expect(result.legacy.objects).toEqual(frozen.objects);
  expect(result.legacy.sequences.find(s => s.name === "users")!.seq).toBe("200");
  expect(result.privateSidecar).toEqual(expanded);
  expect(expanded.tables.find(t => t.name === "users")!.rows[0].password_hash).toBeNull();
});

it("rejects a bootstrap boundary with missing or changed migration artifacts or an unverified import marker", () => {
  const artifacts = [{ tag: "synthetic-baseline", sqlHash: "sql", snapshotHash: "snapshot", when: 1 }];
  const manifest = { id: "synthetic-manifest", migrations: artifacts };
  expect(() => assertExpansionBoundary(manifest, artifacts, { manifestId: manifest.id, phase: "import-verified" })).not.toThrow();
  expect(() => assertExpansionBoundary(manifest, [], { manifestId: manifest.id, phase: "import-verified" })).toThrow();
  expect(() => assertExpansionBoundary(manifest, [{ ...artifacts[0], sqlHash: "changed" }], { manifestId: manifest.id, phase: "import-verified" })).toThrow();
  expect(() => assertExpansionBoundary(manifest, artifacts, { manifestId: "wrong", phase: "import-verified" })).toThrow();
  expect(() => assertExpansionBoundary(manifest, artifacts, { manifestId: manifest.id, phase: "imported" })).toThrow();
});

it("preserves SQL NULL distinctly from missing columns", async () => {
  const result = await reverseForLegacy(expanded, frozen);
  expect(result.legacy.tables.find(t => t.name === "daily_sheets")!.rows[0].note).toBeNull();
  delete expanded.tables.find(t => t.name === "daily_sheets")!.rows[0].note;
  await expect(reverseForLegacy(expanded, frozen)).rejects.toThrow("Missing frozen column");
});

it("pins all baseline SQL, snapshots and journal timestamps against the immutable manifest", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const manifest = (await import("../../drizzle/bootstrap-baseline.json")).default;
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const observed = journal.entries.slice(0, manifest.migrations.length).map((entry: { tag: string; idx: number; when: number }) => ({
    tag: entry.tag, when: entry.when, sqlHash: hash(`drizzle/${entry.tag}.sql`), snapshotHash: hash(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`),
  }));
  expect(createHash("sha256").update(JSON.stringify(observed)).digest("hex")).toBe(manifest.id);
  expect(() => assertExpansionBoundary(manifest, observed, { manifestId: manifest.id, phase: "import-verified" })).not.toThrow();
  expect(journal.entries[manifest.migrations.length].tag).toBe("0009_cloudflare_contracts");
  const supported = (await import("../../drizzle/bootstrap-supported.json")).default;
  expect(supported.layouts[0].migrations).toEqual(manifest.migrations);
  for (const layout of supported.layouts) {
    const current = journal.entries.slice(0, layout.migrations.length).map((entry: { tag: string; idx: number; when: number }) => ({
      tag: entry.tag, when: entry.when, sqlHash: hash(`drizzle/${entry.tag}.sql`), snapshotHash: hash(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`),
    }));
    expect(createHash("sha256").update(JSON.stringify(current)).digest("hex")).toBe(layout.id);
    expect(() => assertPinnedArtifacts(layout, current)).not.toThrow();
  }
});

it("refuses to guess a missing expanded AUTOINCREMENT high-water mark", async () => {
  expanded.sequences = expanded.sequences.filter(s => s.name !== "users");
  await expect(reverseForLegacy(expanded, frozen)).rejects.toThrow("Missing expanded sequence");
});

it("preserves 64-bit sequence marks as exact decimal strings and rejects already-imprecise numbers", async () => {
  expanded.sequences.find(s => s.name === "users")!.seq = "9223372036854775806";
  expect((await reverseForLegacy(expanded, frozen)).legacy.sequences.find(s => s.name === "users")!.seq).toBe("9223372036854775806");
  expanded.sequences.find(s => s.name === "users")!.seq = Number.MAX_SAFE_INTEGER + 1;
  await expect(reverseForLegacy(expanded, frozen)).rejects.toThrow("Unsafe sequence encoding");
});

it("refuses unsafe sequence SQL before constructing test restore statements", () => {
  expanded.sequences[0].seq = "1); DROP TABLE users; --";
  expect(() => fixtureRestoreStatements(expanded)).toThrow("Unsafe sequence encoding");
});

it("rejects a high-water mark below existing IDs instead of repairing it", async () => {
  expanded.sequences.find(s => s.name === "users")!.seq = "0";
  await expect(reverseForLegacy(expanded, frozen)).rejects.toThrow("Sequence below existing IDs");
});

it("assigns destination controls without resetting source bookkeeping or frozen schema epoch", async () => {
  const source = structuredClone(expanded);
  const target = structuredClone(expanded);
  const cloud = source.tables.find(t => t.name === "database_state")!.rows[0];
  const laptop = target.tables.find(t => t.name === "database_state")!.rows[0];
  Object.assign(cloud, { revision: 100, schema_epoch: 7, maintenance: 1, backup_token: "synthetic-cloud-owner" });
  Object.assign(laptop, { revision: 200, schema_epoch: 3 });
  const result = await reverseForLegacy(source, target);
  expect(result.legacy.tables.find(t => t.name === "database_state")!.rows[0]).toEqual({ id: 1, revision: 201, schema_epoch: 3, maintenance: 1, backup_token: null });
  expect(result.privateSidecar).toEqual(source);
  laptop.revision = Number.MAX_SAFE_INTEGER;
  await expect(reverseForLegacy(source, target)).rejects.toThrow("Restore revision exhausted");
});
