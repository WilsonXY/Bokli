#!/usr/bin/env node
// Checks that drizzle/ is internally consistent: every journal entry has its
// SQL file and snapshot, every SQL file and snapshot is in the journal, and the
// snapshots form one prevId -> id chain.
//
// `drizzle-kit generate` only diffs schema.ts against the newest snapshot, so a
// commit that adds the snapshot but forgets the SQL file or the journal update
// would pass it while the migrator never applies the change. This catches that.
//
// Usage: node scripts/check-migrations.mjs [drizzle-dir]   (default: ./drizzle)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_ID = "00000000-0000-0000-0000-000000000000";

/** Returns a list of problems; empty means consistent. */
export function checkMigrations(dir) {
  const problems = [];
  const metaDir = path.join(dir, "meta");
  const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf-8"));

  const listedSql = new Set();
  const listedSnapshots = new Set();
  journal.entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`journal entry ${i} has idx ${entry.idx}`);
    const sql = `${entry.tag}.sql`;
    const snapshot = `${entry.tag.split("_")[0]}_snapshot.json`;
    listedSql.add(sql);
    listedSnapshots.add(snapshot);
    if (!fs.existsSync(path.join(dir, sql))) problems.push(`journal lists ${entry.tag} but drizzle/${sql} is missing`);
    if (!fs.existsSync(path.join(metaDir, snapshot))) {
      problems.push(`journal lists ${entry.tag} but drizzle/meta/${snapshot} is missing`);
    }
  });

  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    if (!listedSql.has(f)) problems.push(`drizzle/${f} is not listed in meta/_journal.json`);
  }
  const snapshots = fs.readdirSync(metaDir).filter((f) => f.endsWith("_snapshot.json")).sort();
  for (const f of snapshots) {
    if (!listedSnapshots.has(f)) problems.push(`drizzle/meta/${f} is not listed in meta/_journal.json`);
  }

  let prevId = ROOT_ID;
  for (const f of snapshots) {
    const snap = JSON.parse(fs.readFileSync(path.join(metaDir, f), "utf-8"));
    if (snap.prevId !== prevId) {
      problems.push(`drizzle/meta/${f} has prevId ${snap.prevId}, expected ${prevId} (the previous snapshot's id)`);
    }
    prevId = snap.id;
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? "drizzle");
  const problems = checkMigrations(dir);
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
  console.log(`OK: ${dir} journal, SQL files and snapshots are consistent`);
}
