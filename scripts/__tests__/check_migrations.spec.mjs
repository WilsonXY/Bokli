import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkMigrations } from "../check-migrations.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO, "scripts/check-migrations.mjs");

describe("scripts/check-migrations.mjs", () => {
  let dir;
  const journalPath = () => path.join(dir, "meta/_journal.json");
  const readJournal = () => JSON.parse(fs.readFileSync(journalPath(), "utf-8"));
  const lastTag = () => readJournal().entries.at(-1).tag;
  const lastSnapshot = () => path.join(dir, "meta", `${lastTag().slice(0, 4)}_snapshot.json`);

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bokli-migrations-")), "drizzle");
    fs.cpSync(path.join(REPO, "drizzle"), dir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it("accepts the committed drizzle/ folder", () => {
    expect(checkMigrations(dir)).toEqual([]);
  });

  it("flags a snapshot committed without its SQL file", () => {
    fs.rmSync(path.join(dir, `${lastTag()}.sql`));
    expect(checkMigrations(dir).join("\n")).toContain(`${lastTag()}.sql`);
  });

  it("flags a snapshot and SQL file the journal does not list", () => {
    const tag = lastTag();
    const journal = readJournal();
    journal.entries.pop();
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    const problems = checkMigrations(dir).join("\n");
    expect(problems).toContain(`${tag}.sql`);
    expect(problems).toContain(`${tag.slice(0, 4)}_snapshot.json`);
  });

  it("flags a missing snapshot", () => {
    fs.rmSync(lastSnapshot());
    expect(checkMigrations(dir).join("\n")).toContain(`${lastTag().slice(0, 4)}_snapshot.json`);
  });

  it("flags a broken snapshot chain (prevId does not match the previous id)", () => {
    const snap = JSON.parse(fs.readFileSync(lastSnapshot(), "utf-8"));
    snap.prevId = "00000000-0000-0000-0000-000000000000";
    fs.writeFileSync(lastSnapshot(), JSON.stringify(snap));
    expect(checkMigrations(dir).join("\n")).toContain("prevId");
  });

  it("CLI exits 1 and names the problem; exits 0 when consistent", () => {
    expect(spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" }).status).toBe(0);
    fs.rmSync(path.join(dir, `${lastTag()}.sql`));
    const res = spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`${lastTag()}.sql`);
  });
});
