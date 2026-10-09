import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";
import { assertLocalD1TestConfig } from "./safety";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import supported from "../../drizzle/bootstrap-supported.json";
import { assertPinnedArtifacts } from "../../src/db/conversion-contracts";

export default defineWorkersConfig(async () => {
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  for (const layout of supported.layouts) {
    const observed = journal.entries.slice(0, layout.migrations.length).map((entry: { tag: string; when: number; idx: number }) => ({
      tag: entry.tag, when: entry.when, sqlHash: hash(`drizzle/${entry.tag}.sql`),
      snapshotHash: hash(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`),
    }));
    assertPinnedArtifacts(layout, observed);
    if (createHash("sha256").update(JSON.stringify(observed)).digest("hex") !== layout.id) throw new Error("Pinned manifest ID changed");
  }
  // No Wrangler config/account. The pool owns ephemeral, per-test storage.
  const workers = {
    singleWorker: true,
    isolatedStorage: true,
    remoteBindings: false,
    miniflare: {
      compatibilityDate: "2026-03-10",
      d1Databases: ["BOKLI_TEST_DB"],
      bindings: { TEST_MIGRATIONS: await readD1Migrations(resolve("drizzle")) },
    },
  };
  assertLocalD1TestConfig(workers);
  return {
    test: {
      include: ["workers/d1-tests/**/*.test.ts"],
      poolOptions: { workers },
    },
  };
});
