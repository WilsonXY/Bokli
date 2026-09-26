import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createFixture,
  destroyFixture,
  release,
  runDeploy as runFixtureDeploy,
  verifyLiveStamp,
  servesBuild,
} from "./fixtures/deploy-fixture.mjs";

// The deploy script now refuses to run from inside the production checkout and
// requires a real service/DB identity, so every case runs against the shared
// disposable fixture (fixtures/deploy-fixture.mjs): `cloneDir` is the live
// production checkout, `authorDir` is where release commits/tags are made, and
// the script under test runs from a separate deployer checkout at origin/main.
// Additional staged-cutover cases live in bokli_deploy_staged.spec.mjs.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "scripts/bokli_deploy.sh");

const T = 120_000; // real npm ci/build/servers per case, run serially

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function holdDeployLock(repoDir) {
  // Holds an exclusive flock on <repoDir>/.deploy.lock the same way the deploy
  // script does, so a concurrently started deploy must refuse.
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      [
        "-c",
        `exec 9>"${path.join(repoDir, ".deploy.lock")}"; flock -n 9 || exit 1; echo held; sleep 60`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    child.stdout.once("data", (data) => {
      if (data.toString().includes("held")) {
        resolve({ release: () => child.kill() });
      } else {
        reject(new Error(`unexpected lock holder output: ${data}`));
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`lock holder exited with ${code}`));
      }
    });
  });
}

describe("scripts/bokli_deploy.sh static verification", () => {
  it("bokli_deploy.sh exists, is executable, and passes bash -n syntax check", () => {
    expect(fs.existsSync(DEPLOY_SCRIPT)).toBe(true);
    expect(() => fs.accessSync(DEPLOY_SCRIPT, fs.constants.X_OK)).not.toThrow();

    const check = spawnSync("bash", ["-n", DEPLOY_SCRIPT], { encoding: "utf-8" });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
  });
});

describe("scripts/bokli_deploy.sh refusal gates and deployment flow", () => {
  let f;
  let cloneDir;
  let authorDir;

  // Runs the deployer checkout's script against the fixture production checkout.
  const runDeploy = (args, env = {}) => runFixtureDeploy(f, args, { env });

  // Tags the author's HEAD (origin/main tip) and moves the deployer to it.
  const tagTip = (tag) => {
    runGit(["tag", "-a", tag, "-m", `Release ${tag}`], authorDir);
    runGit(["push", "origin", tag], authorDir);
  };

  beforeEach(async () => {
    f = await createFixture();
    cloneDir = f.live;
    authorDir = f.author;
  }, T);

  afterEach(() => {
    destroyFixture(f);
  });

  it("refuses if tag argument is missing or unknown option given", () => {
    const resNoArg = runDeploy([]);
    expect(resNoArg.status).toBe(1);
    expect(resNoArg.stderr).toContain("Usage:");

    const resUnknown = runDeploy(["--invalid-flag", "v1.0.0"]);
    expect(resUnknown.status).toBe(1);
    expect(resUnknown.stderr).toContain("Unknown option: --invalid-flag");
  }, T);

  it("refuses if tag contains invalid characters (injection defense)", () => {
    const res = runDeploy(["v1.0.0;malicious"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: invalid tag format 'v1.0.0;malicious'");

    const resNewline = runDeploy(["v1.0.0\ninjected=1"]);
    expect(resNewline.status).toBe(1);
    expect(resNewline.stderr).toContain("❌ Refusing deploy: invalid tag format");
  }, T);

  it("refuses if tag does not exist locally after fetch", () => {
    const res = runDeploy(["v9.9.9"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v9.9.9' does not exist locally after fetch.");
  }, T);

  it("refuses ancestor tag if --allow-rollback is NOT provided", () => {
    // Tag the earlier commit (HEAD~1)
    const initialCommitSha = runGit(["rev-parse", "HEAD~1"], authorDir).trim();
    runGit(["tag", "-a", "v0.9.0-ancestor", initialCommitSha, "-m", "Earlier release"], authorDir);
    runGit(["push", "origin", "v0.9.0-ancestor"], authorDir);

    const res = runDeploy(["v0.9.0-ancestor"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v0.9.0-ancestor'");
    expect(res.stderr).toContain("does not match origin/main tip");
    expect(res.stderr).toContain("To roll back to a previously released ancestor tag, re-run with: --allow-rollback");
  }, T);

  it("allows rollback when tag is an ancestor of origin/main tip and --allow-rollback is given", () => {
    // Tag the earlier commit (HEAD~1)
    const initialCommitSha = runGit(["rev-parse", "HEAD~1"], authorDir).trim();
    runGit(["tag", "-a", "v0.9.0-rollback", initialCommitSha, "-m", "Earlier release"], authorDir);
    runGit(["push", "origin", "v0.9.0-rollback"], authorDir);

    const res = runDeploy(["--allow-rollback", "v0.9.0-rollback"]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("⚠️  Rollback allowed: tag 'v0.9.0-rollback'");
    expect(res.stdout).toContain("is a valid ancestor of origin/main");
    expect(res.stdout).toContain("==> Checking out v0.9.0-rollback...");

    // Verify checked out commit matches ancestor commit
    const currentSha = runGit(["rev-parse", "HEAD"], cloneDir).trim();
    expect(currentSha).toBe(initialCommitSha);
  }, T);

  it("refuses rollback even with --allow-rollback if tag is NOT an ancestor of origin/main", () => {
    // Create a divergent branch with a commit not in main
    runGit(["checkout", "-b", "divergent-branch"], authorDir);
    fs.writeFileSync(path.join(authorDir, "divergent.txt"), "divergent content\n");
    runGit(["add", "divergent.txt"], authorDir);
    runGit(["commit", "-m", "Divergent branch commit"], authorDir);
    runGit(["tag", "-a", "v0.9.0-unrelated", "-m", "Divergent tag"], authorDir);
    runGit(["push", "origin", "v0.9.0-unrelated"], authorDir);

    // Switch back to main
    runGit(["checkout", "main"], authorDir);

    const res = runDeploy(["--allow-rollback", "v0.9.0-unrelated"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing rollback: tag 'v0.9.0-unrelated'");
    expect(res.stderr).toContain("is not an ancestor of origin/main");
    expect(res.stderr).toContain("Rollback is only allowed for commits that exist in origin/main's history.");
  }, T);

  it("untracked files do NOT block deploy, but modified tracked files DO block deploy", () => {
    // Tag current tip of origin/main (fixture already uses v1.0.0 for the running release)
    tagTip("v1.1.0-untracked");

    // Create untracked file (simulating .next-prod or build artifacts)
    fs.writeFileSync(path.join(cloneDir, "untracked_artifact.tmp"), "temporary artifact\n");

    const resUntracked = runDeploy(["v1.1.0-untracked"]);

    expect(resUntracked.status).toBe(0);
    expect(resUntracked.stdout).toContain("==> Checking out v1.1.0-untracked...");

    // Now modify a tracked file
    fs.appendFileSync(path.join(cloneDir, "README.md"), "\nlocal modification\n");

    const resTracked = runDeploy(["v1.1.0-untracked"]);

    expect(resTracked.status).toBe(1);
    expect(resTracked.stderr).toContain("❌ Refusing deploy: working tree has modified tracked files.");
    expect(resTracked.stderr).toContain("Dirty tracked files:");
    expect(resTracked.stderr).toContain("README.md");
  }, T);

  // CHANGED: the SKIP_* seams could report success without a real migrate/build/
  // restart/health check, so they are now refused instead of honoured.
  it("refuses SKIP seams (migrate, build, restart, healthcheck) instead of skipping", () => {
    tagTip("v1.0.0-skip");
    const headBefore = runGit(["rev-parse", "HEAD"], cloneDir).trim();

    const res = runDeploy(["v1.0.0-skip"], {
      BOKLI_DEPLOY_SKIP_MIGRATE: "1",
      BOKLI_DEPLOY_SKIP_BUILD: "1",
      BOKLI_DEPLOY_SKIP_RESTART: "1",
      BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
      BOKLI_DEPLOY_SKIP_SLEEP: "1",
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: unsupported deploy override(s) set:");
    for (const v of ["SKIP_MIGRATE", "SKIP_BUILD", "SKIP_RESTART", "SKIP_HEALTHCHECK", "SKIP_SLEEP"]) {
      expect(res.stderr).toContain(`BOKLI_DEPLOY_${v}`);
    }
    expect(res.stdout).not.toContain("Skipping");
    expect(res.stdout).not.toContain("==> Checking out");
    expect(runGit(["rev-parse", "HEAD"], cloneDir).trim()).toBe(headBefore);
  }, T);

  it("full deploy flow writes valid .next-prod/BUILD_MANIFEST with expected fields", () => {
    tagTip("v1.0.0-manifest");

    const res = runDeploy(["v1.0.0-manifest"]);

    expect(res.status).toBe(0);
    const manifestPath = path.join(cloneDir, ".next-prod/BUILD_MANIFEST");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    expect(manifestContent).toContain("TAG=v1.0.0-manifest\n");
    const headSha = runGit(["rev-parse", "HEAD"], cloneDir).trim();
    expect(manifestContent).toContain(`COMMIT=${headSha}\n`);
    expect(manifestContent).toMatch(/BUILT_AT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n/);
    expect(manifestContent).toContain("DEPLOYED_BY=bokli_deploy.sh\n");

    // Also verify verify_build_stamp.sh succeeds on this manifest
    const verifyRes = spawnSync(path.join(cloneDir, "scripts/verify_build_stamp.sh"), [], {
      cwd: cloneDir,
      encoding: "utf-8",
    });
    expect(verifyRes.status).toBe(0);
    expect(verifyRes.stdout).toContain("Build stamp OK");
  }, T);

  // CHANGED (x3): there is no SKIP_BUILD path any more (a new build is always made
  // and stamped). The stamp guarantee now applies to the CURRENT production build:
  // a deploy refuses to start unless it can roll back to a stamp that verifies.
  it("refuses deploy when the current production build stamp is missing", () => {
    tagTip("v1.0.0-nostamp");
    fs.rmSync(path.join(cloneDir, ".next-prod/BUILD_MANIFEST"));

    const res = runDeploy(["v1.0.0-nostamp"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("the current production build stamp does not verify");
    expect(res.stdout).not.toContain("==> Checking out");
    expect(runGit(["rev-parse", "HEAD"], cloneDir).trim()).toBe(f.oldHead);
  }, T);

  it("refuses deploy when the current production build stamp is stale or points to different commit", () => {
    tagTip("v1.0.0-stale");
    // Write stamp with a mismatched commit
    fs.writeFileSync(
      path.join(cloneDir, ".next-prod/BUILD_MANIFEST"),
      "TAG=v1.0.0\nCOMMIT=0123456789abcdef0123456789abcdef01234567\nBUILT_AT=2026-01-01T00:00:00Z\nDEPLOYED_BY=bokli_deploy.sh\n"
    );

    const res = runDeploy(["v1.0.0-stale"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("the current production build stamp does not verify");
    expect(runGit(["rev-parse", "HEAD"], cloneDir).trim()).toBe(f.oldHead);
  }, T);

  it("refuses deploy when the current production build stamp has an empty required field", () => {
    tagTip("v1.0.0-emptyfield");
    // Write stamp with empty TAG=
    fs.writeFileSync(
      path.join(cloneDir, ".next-prod/BUILD_MANIFEST"),
      `TAG=\nCOMMIT=${runGit(["rev-parse", "HEAD"], cloneDir).trim()}\nBUILT_AT=2026-01-01T00:00:00Z\nDEPLOYED_BY=bokli_deploy.sh\n`
    );

    const res = runDeploy(["v1.0.0-emptyfield"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("the current production build stamp does not verify");
    expect(runGit(["rev-parse", "HEAD"], cloneDir).trim()).toBe(f.oldHead);
  }, T);

  // CHANGED: BOKLI_DEPLOY_HEALTHCHECK_URL could point the check at any healthy
  // server, so it is refused. The check now always targets the service's own port
  // and also requires the NEW build's static manifest (only that build has it).
  it("performs the post-restart health check against the service port (HEALTHCHECK_URL override refused)", () => {
    tagTip("v1.0.0-health");

    const resOverride = runDeploy(["v1.0.0-health"], {
      BOKLI_DEPLOY_HEALTHCHECK_URL: "http://127.0.0.1:1/login",
    });
    expect(resOverride.status).toBe(1);
    expect(resOverride.stderr).toContain("BOKLI_DEPLOY_HEALTHCHECK_URL");

    const resSuccess = runDeploy(["v1.0.0-health"]);
    expect(resSuccess.status).toBe(0);
    expect(resSuccess.stdout).toContain("✅ deployed v1.0.0-health, /login returns 200");

    // A release whose /login breaks only against the live DB passes every
    // pre-cutover smoke test (they use DB copies) and fails the post-restart check.
    release(f, "v1.0.0-health-broken", { failOnDbName: "bokli.db" });
    const resFail = runDeploy(["v1.0.0-health-broken"], { BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS: "3" });

    expect(resFail.status).toBe(3);
    expect(resFail.stderr).toContain("❌ FAIL: deployed v1.0.0-health-broken, but http://127.0.0.1");
    expect(resFail.stderr).toContain("returned HTTP 500");
    expect(resFail.stderr).toContain("journalctl --user -u bokli");
  }, T);

  it("refuses a second deploy while another deploy holds the .deploy.lock", async () => {
    tagTip("v1.0.0-lock");

    const lockHolder = await holdDeployLock(cloneDir);
    try {
      const res = runDeploy(["v1.0.0-lock"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("❌ Refusing deploy: another deploy is already running");
      expect(res.stderr).toContain(".deploy.lock");
      // Refused before any mutation: no checkout happened.
      expect(res.stdout).not.toContain("==> Checking out");
    } finally {
      lockHolder.release();
    }
  }, T);

  it("releases the .deploy.lock when the deploy finishes, so the next deploy can run", () => {
    tagTip("v1.0.0-lockfree");

    const first = runDeploy(["v1.0.0-lockfree"]);
    expect(first.status).toBe(0);
    expect(fs.existsSync(path.join(cloneDir, ".deploy.lock"))).toBe(true);

    const second = runDeploy(["v1.0.0-lockfree"]);
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain("another deploy is already running");
  }, T);

  // CHANGED: BOKLI_DEPLOY_BUILD_CMD could stamp a build that never ran; it is now
  // refused outright (with or without TEST_MODE), before any mutation.
  it("refuses BOKLI_DEPLOY_BUILD_CMD (no test mode can enable it)", () => {
    tagTip("v1.0.0-buildcmd");
    const stampBefore = fs.readFileSync(path.join(cloneDir, ".next-prod/BUILD_MANIFEST"), "utf-8");

    const res = runDeploy(["v1.0.0-buildcmd"], { BOKLI_DEPLOY_BUILD_CMD: "true" });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: unsupported deploy override(s) set: BOKLI_DEPLOY_BUILD_CMD");
    // Refused before any mutation: no checkout and no fresh build stamp.
    expect(res.stdout).not.toContain("==> Checking out");
    expect(fs.readFileSync(path.join(cloneDir, ".next-prod/BUILD_MANIFEST"), "utf-8")).toBe(stampBefore);
  }, T);

  it("refuses BOKLI_DEPLOY_TEST_MODE=1 + BUILD_CMD instead of honouring them (no fake stamp)", () => {
    tagTip("v1.0.0-testmode");
    const stampBefore = fs.readFileSync(path.join(cloneDir, ".next-prod/BUILD_MANIFEST"), "utf-8");

    const res = runDeploy(["v1.0.0-testmode"], {
      BOKLI_DEPLOY_TEST_MODE: "1",
      BOKLI_DEPLOY_BUILD_CMD: "true",
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("BOKLI_DEPLOY_BUILD_CMD");
    expect(res.stderr).toContain("BOKLI_DEPLOY_TEST_MODE");
    expect(res.stdout).not.toContain("THIS IS NOT A REAL DEPLOY");
    expect(res.stdout).not.toContain("TEST MODE: running BOKLI_DEPLOY_BUILD_CMD");
    expect(fs.readFileSync(path.join(cloneDir, ".next-prod/BUILD_MANIFEST"), "utf-8")).toBe(stampBefore);
    expect(verifyLiveStamp(f).status).toBe(0);
    expect(servesBuild(f, f.oldBuildId)).toBe(true);
  }, T);
});
