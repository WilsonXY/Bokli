import { applyD1Migrations, env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { costLines, dailySheets, monthCloseEvents } from "../../src/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { sheetFixture, costLineFixtures } from "./fixtures";
import { createD1Adapter, runD1Batch } from "../d1";

describe("explicit D1 binding", () => {
  it("rejects a missing binding rather than falling back to SQLite", () => {
    expect(() => createD1Adapter(undefined)).toThrow("D1 binding is required");
  });
});

const tables = [
  "cost_lines", "daily_sheets", "login_attempts", "month_close_events",
  "month_closes", "operating_expense_add_requests", "operating_expenses", "users",
];

beforeEach(async () => {
  // Each test really starts empty; a leaked schema/persistence path fails here.
  const existing = await env.BOKLI_TEST_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA'",
  ).all();
  expect(existing.results).toEqual([]);
  await applyD1Migrations(env.BOKLI_TEST_DB, env.TEST_MIGRATIONS);
});

it("bootstraps an empty local D1 from every current migration", async () => {
  const db = env.BOKLI_TEST_DB;
  expect((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA') ORDER BY name").all()).results.map((row) => row.name)).toEqual(tables);
  expect((await db.prepare("SELECT name FROM d1_migrations ORDER BY name").all()).results.map((row) => row.name)).toEqual(env.TEST_MIGRATIONS.map((migration) => migration.name));
  for (const table of tables) {
    // Only the fixed test-owned identifiers above enter SQL text.
    expect(await db.prepare(`SELECT count(*) AS count FROM ${table}`).first("count")).toBe(0);
  }
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(await db.prepare("PRAGMA quick_check").first("quick_check")).toBe("ok");
  // Reapply with synthetic rows present: schema, full rows and records stay put.
  const adapter = createD1Adapter(db);
  await adapter.insert(dailySheets).values(sheetFixture);
  await adapter.insert(costLines).values(costLineFixtures);
  const sheetsBefore = await adapter.select().from(dailySheets);
  const linesBefore = await adapter.select().from(costLines).orderBy(costLines.id);
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  expect((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA') ORDER BY name").all()).results.map((row) => row.name)).toEqual(tables);
  expect(await adapter.select().from(dailySheets)).toEqual(sheetsBefore);
  expect(await adapter.select().from(costLines).orderBy(costLines.id)).toEqual(linesBefore);
  expect(await db.prepare("SELECT count(*) FROM d1_migrations").first("count(*)")).toBe(env.TEST_MIGRATIONS.length);
});

it("commits a prepared Drizzle batch with bound values and ordered results", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  const note = "synthetic '); DROP TABLE daily_sheets; --";
  const [sheets, lines] = await runD1Batch(db, [
    db.insert(dailySheets).values({ id: 41, date: "2026-01-02", cashSen: 1234, tngSen: 567, note }).returning(),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 250, category: "restock" }).returning(),
  ]);
  expect(sheets[0]).toMatchObject({ id: 41, date: "2026-01-02", cashSen: 1234, tngSen: 567, note });
  expect(lines[0]).toMatchObject({ dailySheetId: 41, amountSen: 250, category: "restock" });
  expect(await db.select().from(dailySheets).where(eq(dailySheets.id, 41))).toEqual(sheets);
  expect(await db.select().from(costLines)).toEqual(lines);
});

it("classifies an enforced foreign key failure and rolls back the whole batch", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await expect(runD1Batch(db, [
    db.insert(dailySheets).values({ id: 41, date: "2026-01-02", cashSen: 1234 }),
    db.insert(costLines).values({ dailySheetId: 999, amountSen: 250, category: "restock" }),
    db.insert(dailySheets).values({ id: 42, date: "2026-01-03", cashSen: 4321 }),
  ])).rejects.toMatchObject({ kind: "foreign-key", cause: expect.any(Error) });
  expect(await db.select().from(dailySheets)).toEqual([]);
  expect(await db.select().from(costLines)).toEqual([]);
});

it("classifies CHECK failures without leaving a newly created Daily Sheet", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await expect(runD1Batch(db, [
    db.insert(dailySheets).values({ id: 41, date: "2026-01-02", cashSen: 1234 }),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 250, category: "restock" }),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 0, category: "gas" }),
  ])).rejects.toMatchObject({ kind: "check", cause: expect.any(Error) });
  expect(await db.select().from(dailySheets)).toEqual([]);
  expect(await db.select().from(costLines)).toEqual([]);
});

it("surfaces an explicitly recognized trigger abort and restores the entire existing payload", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await db.insert(dailySheets).values(sheetFixture);
  await db.insert(costLines).values(costLineFixtures);
  const originalSheets = await db.select().from(dailySheets);
  const originalLines = await db.select().from(costLines).orderBy(costLines.id);
  // Test-owned trigger only. PR1 introduces no production lock schema or code.
  await env.BOKLI_TEST_DB.prepare(`CREATE TRIGGER foundation_abort BEFORE INSERT ON cost_lines
    WHEN NEW.note = 'abort-fixture'
    BEGIN SELECT RAISE(ABORT, 'FOUNDATION_TEST_ABORT'); END`).run();
  const failure = await runD1Batch(db, [
    db.update(dailySheets).set({ cashSen: 9999, tngSen: 8888, note: "replacement" }).where(eq(dailySheets.id, 41)),
    db.delete(costLines).where(eq(costLines.dailySheetId, 41)),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 777, category: "other", note: "new valid line" }),
    db.insert(monthCloseEvents).values({ month: "2026-01", action: "close", at: "2026-01-31", snapshot: "synthetic" }),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 888, category: "other", note: "abort-fixture" }),
    db.insert(dailySheets).values({ date: "2026-01-03", cashSen: 4321 }),
  ], ["FOUNDATION_TEST_ABORT"]).catch((error: unknown) => error);
  expect(failure).toMatchObject({ kind: "trigger", cause: expect.any(Error) });
  expect((failure as Error).cause).toHaveProperty("message", expect.stringContaining("FOUNDATION_TEST_ABORT"));
  expect(await db.select().from(dailySheets)).toEqual(originalSheets);
  expect(await db.select().from(costLines).orderBy(costLines.id)).toEqual(originalLines);
  expect(await db.select().from(monthCloseEvents)).toEqual([]);
  expect((await env.BOKLI_TEST_DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

it("classifies uniqueness failures and preserves the earlier complete Daily Sheet", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await db.insert(dailySheets).values({ id: 41, date: "2026-01-02", cashSen: 1234 });
  const original = await db.select().from(dailySheets);
  await expect(runD1Batch(db, [
    db.update(dailySheets).set({ cashSen: 9999 }).where(eq(dailySheets.id, 41)),
    db.insert(dailySheets).values({ date: "2026-01-02", cashSen: 4321 }),
  ])).rejects.toMatchObject({ kind: "unique", cause: expect.any(Error) });
  expect(await db.select().from(dailySheets)).toEqual(original);
});

it("enforces the existing cascading Cost Line foreign key", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await runD1Batch(db, [
    db.insert(dailySheets).values({ id: 41, date: "2026-01-02", cashSen: 1234 }),
    db.insert(costLines).values({ dailySheetId: 41, amountSen: 250, category: "restock" }),
  ]);
  await runD1Batch(db, [db.delete(dailySheets).where(eq(dailySheets.id, 41))]);
  expect(await db.select().from(dailySheets)).toEqual([]);
  expect(await db.select().from(costLines)).toEqual([]);
});

it("leaves an unrecognized trigger error unknown while preserving its cause", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await env.BOKLI_TEST_DB.prepare(`CREATE TRIGGER foundation_unknown BEFORE INSERT ON daily_sheets
    BEGIN SELECT RAISE(ABORT, 'UNRECOGNIZED_FOUNDATION_ABORT'); END`).run();
  const failure = await runD1Batch(db, [db.insert(dailySheets).values({ date: "2026-01-02" })], ["FOUNDATION_ABORT"])
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ kind: "unknown", cause: expect.any(Error) });
  expect((failure as Error).cause).toHaveProperty("message", expect.stringContaining("UNRECOGNIZED_FOUNDATION_ABORT"));
  expect(await db.select().from(dailySheets)).toEqual([]);
});

it("keeps SQL errors unknown and rolls back earlier batch statements", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  const failure = await runD1Batch(db, [
    db.insert(dailySheets).values({ id: 41, date: "2026-01-02" }),
    db.run(sql`INSERT INTO foundation_missing_table VALUES (1)`),
  ]).catch((error: unknown) => error);
  expect(failure).toMatchObject({ kind: "unknown", cause: expect.any(Error) });
  expect((failure as Error).cause).toHaveProperty("message", expect.stringContaining("no such table"));
  expect(await db.select().from(dailySheets)).toEqual([]);
});

it("starts another test with no synthetic rows or test-only triggers", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  expect(await db.select().from(dailySheets)).toEqual([]);
  expect(await db.select().from(costLines)).toEqual([]);
  const expected = env.TEST_MIGRATIONS.flatMap(migration => migration.queries.flatMap(query =>
    [...query.matchAll(/CREATE TRIGGER (\w+)/g)].map(match => ({ name: match[1] })))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  expect((await env.BOKLI_TEST_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).results).toEqual(expected);
});

it("gives an exact registered trigger message precedence over CHECK-like text", async () => {
  const db = createD1Adapter(env.BOKLI_TEST_DB);
  await env.BOKLI_TEST_DB.prepare(`CREATE TRIGGER foundation_known BEFORE INSERT ON daily_sheets
    BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: FOUNDATION_TRIGGER'); END`).run();
  await expect(runD1Batch(db, [db.insert(dailySheets).values({ date: "2026-01-02" })], ["CHECK constraint failed: FOUNDATION_TRIGGER"]))
    .rejects.toMatchObject({ kind: "trigger", cause: expect.any(Error) });
  expect(await db.select().from(dailySheets)).toEqual([]);
});
