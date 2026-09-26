// Tests for scripts/bokli_deploy.sh (staged build + guarded cutover).
//
// Every test runs the ACTUAL deploy script against a disposable fixture (see
// fixtures/deploy-fixture.mjs): a fake origin, a live "prod" checkout running
// v1.0.0 (which ships the legacy v1.1.1 deploy script, like production today),
// a throwaway SQLite DB, a fake `systemctl --user` whose ExecStartPre runs the
// real verify_build_stamp.sh, and a SEPARATE deployer checkout holding the new
// script (the first-hop bootstrap path). Nothing here touches the real prod
// checkout, DB or systemd.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  NEW_DEPLOY_SCRIPT,
  createFixture,
  destroyFixture,
  release,
  runDeploy,
  liveState,
  verifyLiveStamp,
  servesBuild,
  calls,
  inject,
  systemctl,
  git,
  sqlite,
  dbDump,
  waitFor,
  baseUrl,
  httpCode,
} from "./fixtures/deploy-fixture.mjs";

const T = 120_000; // per-test timeout (real npm ci/build/servers, run serially)

function stampFields(text) {
  return Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
}

/** Asserts production is exactly as before and the OLD service still serves. */
function expectUntouched(f, before) {
  expect(liveState(f)).toEqual(before);
  expect(verifyLiveStamp(f).status).toBe(0);
  expect(servesBuild(f, f.oldBuildId)).toBe(true);
  expect(fs.existsSync(f.journal)).toBe(false);
}

describe("scripts/bokli_deploy.sh static verification", () => {
  it("exists, is executable, and passes bash -n", () => {
    expect(() => fs.accessSync(NEW_DEPLOY_SCRIPT, fs.constants.X_OK)).not.toThrow();
    const check = spawnSync("bash", ["-n", NEW_DEPLOY_SCRIPT], { encoding: "utf-8" });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
  });
});

describe("scripts/bokli_deploy.sh (fixture production)", () => {
  let f;
  beforeEach(async () => {
    f = await createFixture();
  }, T);
  afterEach(() => destroyFixture(f));

  // -------------------------------------------------------------------------
  // BEFORE: the legacy (installed v1.1.1) script, run from the prod checkout
  // -------------------------------------------------------------------------
  it("BEFORE: legacy v1.1.1 script moves HEAD, migrates the live DB and erases the old build when the build fails", () => {
    release(f, "v1.1.1-broken", { buildFail: true });
    const before = liveState(f);
    // Exactly how prod deploys today: the installed script inside the live checkout.
    const res = runDeploy(f, ["v1.1.1-broken"], {
      script: path.join(f.live, "scripts/bokli_deploy.sh"),
      cwd: f.live,
      env: { BOKLI_DEPLOY_HEALTHCHECK_URL: `${baseUrl(f)}/login` },
    });
    expect(res.status).not.toBe(0);
    const after = liveState(f);
    expect(after.head).not.toBe(before.head); // checkout moved before the build
    expect(after.db).not.toBe(before.db); // live DB migrated for a release that never shipped
    expect(after.buildDigest).not.toBe(before.buildDigest); // old artifacts erased in place
    expect(fs.existsSync(path.join(f.live, ".next-prod/OLD-ARTIFACT-SENTINEL"))).toBe(false);
    expect(verifyLiveStamp(f).status).not.toBe(0); // a restart/reboot can no longer start the old service
  }, T);

  // -------------------------------------------------------------------------
  // AFTER: preparation failures never touch production
  // -------------------------------------------------------------------------
  it("AFTER: build failure leaves HEAD, stamp, artifacts, node_modules, DB and the running service unchanged", () => {
    release(f, "v1.1.1-broken", { buildFail: true });
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.1-broken"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("production was not touched");
    expectUntouched(f, before);
    expect(calls(f).filter((c) => /^(stop|start|restart)/.test(c))).toEqual(["start bokli"]); // only fixture boot
  }, T);

  it("build that omits standalone static assets is rejected before cutover", () => {
    release(f, "v1.1.1-nostatic", { skipStaticCopy: true });
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.1-nostatic"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("_buildManifest.js");
    expectUntouched(f, before);
  }, T);

  it("candidate that fails its pre-cutover smoke test (unhealthy /login) is rejected before cutover", () => {
    release(f, "v1.1.1-unhealthy", { loginStatus: 500 });
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.1-unhealthy"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/smoke test failed/);
    expectUntouched(f, before);
  }, T);

  it("migration that fails on the rehearsal copy is rejected before cutover; live DB untouched", () => {
    release(f, "v1.1.1-badsql", { extraMigrations: { "0002_bad.sql": "THIS IS NOT SQL;\n" } });
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.1-badsql"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("migration rehearsal failed");
    expectUntouched(f, before);
  }, T);

  // -------------------------------------------------------------------------
  // Successful cutover (first hop: new script from a separate checkout)
  // -------------------------------------------------------------------------
  it("first hop: deploys v1.1.0 from the separate deployer checkout with correct ordering, stamp, DB and service", () => {
    const tagCommit = git(["rev-parse", "v1.1.0^{commit}"], f.author);
    const res = runDeploy(f, ["v1.1.0"]);
    expect(res.stderr).not.toContain("❌");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("✅ deployed v1.1.0, /login returns 200");

    // Code + stamp
    expect(git(["rev-parse", "HEAD"], f.live)).toBe(tagCommit);
    const stamp = stampFields(fs.readFileSync(path.join(f.live, ".next-prod/BUILD_MANIFEST"), "utf-8"));
    const newBuildId = fs.readFileSync(path.join(f.live, ".next-prod/BUILD_ID"), "utf-8").trim();
    expect(stamp).toMatchObject({ TAG: "v1.1.0", COMMIT: tagCommit, DEPLOYED_BY: "bokli_deploy.sh", BUILD_ID: newBuildId });
    expect(newBuildId).not.toBe(f.oldBuildId);
    expect(verifyLiveStamp(f).status).toBe(0);
    expect(fs.existsSync(path.join(f.live, ".next-prod/OLD-ARTIFACT-SENTINEL"))).toBe(false);

    // Service really runs the new build (a static asset only the new build has)
    expect(servesBuild(f, newBuildId)).toBe(true);
    expect(httpCode(`${baseUrl(f)}/_next/static/${f.oldBuildId}/_buildManifest.js`)).toBe("404");

    // DB migrated, data preserved, no stray sidecars from the swap
    expect(sqlite(f.db, "SELECT group_concat(note) FROM (SELECT note FROM sheets ORDER BY id)")).toBe("day-1,day-2,dup");
    expect(sqlite(f.db, "SELECT count(*) FROM pragma_table_info('sheets') WHERE name='amount'")).toBe("1");

    // Ordering: all preparation before the one stop; stop → snapshot → migrate → switch → verify → start
    const out = res.stdout;
    const idx = (s) => {
      const i = out.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      "Rehearsing migrations",
      "Building",
      "Smoke-testing candidate",
      "PHASE stopping",
      "PHASE stopped",
      "PHASE db-swapped",
      "PHASE code-switched",
      "PHASE verified",
      "PHASE start-invoked",
      "PHASE done",
    ].map(idx);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(calls(f).filter((c) => /^(stop|start|restart)/.test(c))).toEqual(["start bokli", "stop bokli", "start bokli"]);

    // Fresh verified snapshot + previous release kept for manual rollback
    const runs = fs.readdirSync(path.join(f.stateDir, "runs"));
    expect(runs).toHaveLength(1);
    const runDir = path.join(f.stateDir, "runs", runs[0]);
    const snap = path.join(runDir, "snapshot.db");
    expect(sqlite(snap, "PRAGMA integrity_check")).toBe("ok");
    expect(sqlite(snap, "SELECT count(*) FROM pragma_table_info('sheets') WHERE name='amount'")).toBe("0");
    expect(fs.existsSync(path.join(runDir, "prev/.next-prod/OLD-ARTIFACT-SENTINEL"))).toBe(true);
    for (const leftover of ["candidate.db", "candidate.db-wal", "candidate.db-shm", "rehearsal.db", "src"]) {
      expect(fs.existsSync(path.join(runDir, leftover)), leftover).toBe(false);
    }
    expect(fs.existsSync(f.journal)).toBe(false);

    // From now on the script in the live checkout refuses to deploy from inside it
    const inside = runDeploy(f, ["v1.1.0"], { script: path.join(f.live, "scripts/bokli_deploy.sh"), cwd: f.live });
    expect(inside.status).toBe(1);
    expect(inside.stderr).toContain("must not run from inside the production checkout");
  }, T);

  it("--allow-rollback redeploys an ancestor tag (v1.0.0) via the newest script; forward-only DB kept", () => {
    expect(runDeploy(f, ["v1.1.0"]).status).toBe(0);
    const res = runDeploy(f, ["--allow-rollback", "v1.0.0"]);
    expect(res.stdout).toContain("Rollback allowed");
    expect(res.status).toBe(0);
    expect(git(["rev-parse", "HEAD"], f.live)).toBe(f.oldHead);
    expect(verifyLiveStamp(f).status).toBe(0);
    const id = fs.readFileSync(path.join(f.live, ".next-prod/BUILD_ID"), "utf-8").trim();
    expect(servesBuild(f, id)).toBe(true);
    expect(sqlite(f.db, "SELECT count(*) FROM pragma_table_info('sheets') WHERE name='amount'")).toBe("1");
  }, T);

  // -------------------------------------------------------------------------
  // Cutover failures before the new service could accept writes → full rollback
  // -------------------------------------------------------------------------
  it("live migration failure during cutover rolls back and restarts the old release; the late write is kept", () => {
    // A write lands after the rehearsal but before the stop, making the unique index fail on the live data.
    inject(f, "stop-before", "sql:INSERT INTO sheets (note) VALUES ('dup');");
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.0"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ROLLED BACK");
    const after = liveState(f);
    expect({ ...after, db: null }).toEqual({ ...before, db: null });
    expect(sqlite(f.db, "SELECT count(*) FROM sheets WHERE note='dup'")).toBe("2"); // nothing lost
    expect(sqlite(f.db, "SELECT count(*) FROM pragma_table_info('sheets') WHERE name='amount'")).toBe("0");
    expect(verifyLiveStamp(f).status).toBe(0);
    expect(servesBuild(f, f.oldBuildId)).toBe(true);
    expect(fs.existsSync(f.journal)).toBe(false);
  }, T);

  it("SIGTERM during cutover triggers the trap: old checkout/build/stamp/DB restored and old service restarted", () => {
    inject(f, "stop-after", "term-deployer");
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.0"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ROLLED BACK");
    expectUntouched(f, before);
  }, T);

  it("service that fails ExecStartPre (never ran) is rolled back automatically", () => {
    inject(f, "start-before", "fail");
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.0"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ROLLED BACK");
    expectUntouched(f, before);
  }, T);

  it("SIGKILL mid-cutover leaves a journal; deploys are refused until --recover restores and verifies the old release", () => {
    inject(f, "start-before", "kill9-deployer");
    const before = liveState(f);
    const res = runDeploy(f, ["v1.1.0"]);
    expect(res.signal).toBe("SIGKILL");
    expect(fs.existsSync(f.journal)).toBe(true);
    expect(verifyLiveStamp(f).status).toBe(0); // new code+stamp already switched in...
    expect(servesBuild(f, f.oldBuildId)).toBe(false); // ...and the service is down

    const again = runDeploy(f, ["v1.1.0"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("--recover");

    const rec = runDeploy(f, ["--recover"]);
    expect(rec.stdout + rec.stderr).toContain("ROLLED BACK");
    expect(rec.status).toBe(0);
    expectUntouched(f, before);
  }, T);

  // -------------------------------------------------------------------------
  // After the new service may have accepted writes: never auto-restore the DB
  // -------------------------------------------------------------------------
  it("new build started, wrote, then failed health: exit 3, DB keeps the write, journal blocks deploys, --recover refuses", () => {
    // Passes every pre-cutover smoke test (they use DB copies) but fails once pointed at the live DB file.
    release(f, "v1.1.1-writes", { writeOnStart: true, failOnDbName: "bokli.db" });
    const res = runDeploy(f, ["v1.1.1-writes"], { env: { BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS: "3" } });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain("MANUAL RECOVERY REQUIRED");
    expect(res.stdout).not.toContain("✅ deployed");
    expect(sqlite(f.db, "SELECT count(*) FROM sheets WHERE note LIKE 'written-by-v1.1.1-writes-%'")).not.toBe("0");
    expect(sqlite(f.db, "SELECT count(*) FROM pragma_table_info('sheets') WHERE name='amount'")).toBe("1");
    expect(fs.existsSync(f.journal)).toBe(true);

    const dbBefore = dbDump(f.db);
    const rec = runDeploy(f, ["--recover"]);
    expect(rec.status).toBe(3);
    expect(rec.stderr).toContain("MANUAL RECOVERY REQUIRED");
    expect(dbDump(f.db)).toBe(dbBefore);
    const again = runDeploy(f, ["v1.1.1-writes"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("--recover");
  }, T);

  it("service main started externally after a crash (e.g. reboot auto-start) → --recover will not restore the DB", async () => {
    inject(f, "start-before", "kill9-deployer");
    expect(runDeploy(f, ["v1.1.0"]).signal).toBe("SIGKILL");
    // Simulate systemd starting the (already switched) new release on its own and a user writing.
    expect(systemctl(f, "start", "bokli").status).toBe(0);
    await waitFor(() => httpCode(`${baseUrl(f)}/login`) === "200");
    sqlite(f.db, "INSERT INTO sheets (note) VALUES ('mom-wrote-this')");
    const rec = runDeploy(f, ["--recover"]);
    expect(rec.status).toBe(3);
    expect(rec.stderr).toContain("MANUAL RECOVERY REQUIRED");
    expect(sqlite(f.db, "SELECT count(*) FROM sheets WHERE note='mom-wrote-this'")).toBe("1");
    expect(fs.existsSync(f.journal)).toBe(true);
  }, T);

  it("cannot claim success while an OLD build answers on the service port", () => {
    fs.cpSync(path.join(f.live, ".next-prod"), path.join(f.sd, "oldbuild"), { recursive: true });
    inject(f, "start-before", "start-old");
    const res = runDeploy(f, ["v1.1.0"], { env: { BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS: "3" } });
    expect(res.status).toBe(3);
    expect(res.stdout).not.toContain("✅ deployed");
    expect(res.stderr).toContain("MANUAL RECOVERY REQUIRED");
  }, T);

  // -------------------------------------------------------------------------
  // Target identity and gates (all refused before any mutation)
  // -------------------------------------------------------------------------
  it("--recover takes no tag or options", () => {
    const before = liveState(f);
    const res = runDeploy(f, ["--recover", "v1.1.0"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--recover takes no tag");
    expectUntouched(f, before);
  }, T);

  it("refuses wrong production checkout or DB targets", () => {
    const before = liveState(f);
    const other = path.join(f.root, "other-clone");
    git(["clone", "--quiet", f.origin, other], f.root);
    const copyDb = path.join(f.root, "copy.db");
    fs.copyFileSync(f.db, copyDb);
    const devDir = path.join(f.root, "data-dev");
    fs.mkdirSync(devDir);
    fs.copyFileSync(f.db, path.join(devDir, "bokli.db"));

    const cases = [
      [{ BOKLI_REPO_DIR: "" }, "BOKLI_REPO_DIR is not set"],
      [{ BOKLI_REPO_DIR: other }, "is not the bokli service WorkingDirectory"],
      [{ BOKLI_DB_PATH: "" }, "BOKLI_DB_PATH is not set"],
      [{ BOKLI_DB_PATH: copyDb }, "is not the database the bokli service uses"],
      [{ BOKLI_DB_PATH: path.join(devDir, "bokli.db") }, "data-dev"],
      [{ BOKLI_REPO_DIR: f.deployer }, "must not run from inside the production checkout"],
    ];
    for (const [env, msg] of cases) {
      const res = runDeploy(f, ["v1.1.0"], { env });
      expect(res.status, msg).toBe(1);
      expect(res.stderr, msg).toContain(msg);
    }
    expectUntouched(f, before);
    expect(fs.existsSync(f.stateDir)).toBe(false);
  }, T);

  it("refuses removed test/skip seams that could fake success", () => {
    const before = liveState(f);
    for (const env of [
      { BOKLI_DEPLOY_SKIP_BUILD: "1" },
      { BOKLI_DEPLOY_SKIP_MIGRATE: "1" },
      { BOKLI_DEPLOY_SKIP_RESTART: "1" },
      { BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1" },
      { BOKLI_DEPLOY_BUILD_CMD: "true", BOKLI_DEPLOY_TEST_MODE: "1" },
      { BOKLI_DEPLOY_HEALTHCHECK_URL: "http://127.0.0.1:1/login" },
    ]) {
      const res = runDeploy(f, ["v1.1.0"], { env });
      expect(res.status, JSON.stringify(env)).toBe(1);
      expect(res.stderr).toContain("unsupported deploy override");
    }
    expectUntouched(f, before);
  }, T);

  it("refuses a deployer checkout that is not exactly origin/main (stale or locally modified script)", () => {
    const before = liveState(f);
    fs.appendFileSync(path.join(f.deployer, "scripts/bokli_deploy.sh"), "\n# local edit\n");
    let res = runDeploy(f, ["v1.1.0"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("modified tracked files");
    git(["checkout", "--", "scripts/bokli_deploy.sh"], f.deployer);

    release(f, "v1.1.1");
    git(["checkout", "--quiet", "--detach", "v1.1.0"], f.deployer); // stale deployer
    res = runDeploy(f, ["--allow-rollback", "v1.1.0"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("is not origin/main");
    expectUntouched(f, before);
  }, T);

  it("--recover with no pending cutover is a no-op", () => {
    const before = liveState(f);
    const res = runDeploy(f, ["--recover"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No incomplete cutover");
    expectUntouched(f, before);
  }, T);
});
