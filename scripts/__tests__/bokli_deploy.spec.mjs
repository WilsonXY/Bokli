import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "scripts/bokli_deploy.sh");
const RELEASE_SCRIPT = path.join(REPO_ROOT, "scripts/bokli_release.sh");

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runDeploy(scriptPath, args, env = {}, cwd) {
  return spawnSync(scriptPath, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
  });
}

describe("scripts/bokli_deploy.sh and bokli_release.sh static verification", () => {
  it("bokli_deploy.sh exists, is executable, and passes bash -n syntax check", () => {
    expect(fs.existsSync(DEPLOY_SCRIPT)).toBe(true);
    expect(() => fs.accessSync(DEPLOY_SCRIPT, fs.constants.X_OK)).not.toThrow();

    const check = spawnSync("bash", ["-n", DEPLOY_SCRIPT], { encoding: "utf-8" });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
  });

  it("bokli_release.sh exists, is executable, and passes bash -n syntax check", () => {
    expect(fs.existsSync(RELEASE_SCRIPT)).toBe(true);
    expect(() => fs.accessSync(RELEASE_SCRIPT, fs.constants.X_OK)).not.toThrow();

    const check = spawnSync("bash", ["-n", RELEASE_SCRIPT], { encoding: "utf-8" });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
  });
});

describe("scripts/bokli_deploy.sh refusal gates and deployment flow", () => {
  let fixtureDir;
  let bareOriginDir;
  let cloneDir;
  let fixtureDeployScript;
  let fixtureReleaseScript;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-git-fixture-"));
    bareOriginDir = path.join(fixtureDir, "origin.git");
    cloneDir = path.join(fixtureDir, "clone");

    // Initialize bare origin and clone
    runGit(["init", "--bare", bareOriginDir]);
    runGit(["clone", bareOriginDir, cloneDir]);
    runGit(["config", "user.email", "deploy-test@example.com"], cloneDir);
    runGit(["config", "user.name", "Deploy Test"], cloneDir);
    runGit(["checkout", "-b", "main"], cloneDir);

    // Initial commit
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Test Repo\n");
    runGit(["add", "README.md"], cloneDir);
    runGit(["commit", "-m", "Initial commit on main"], cloneDir);
    runGit(["push", "-u", "origin", "main"], cloneDir);

    // Copy scripts into fixture clone
    fs.mkdirSync(path.join(cloneDir, "scripts"), { recursive: true });
    fixtureDeployScript = path.join(cloneDir, "scripts/bokli_deploy.sh");
    fixtureReleaseScript = path.join(cloneDir, "scripts/bokli_release.sh");

    fs.copyFileSync(DEPLOY_SCRIPT, fixtureDeployScript);
    fs.chmodSync(fixtureDeployScript, 0o755);

    fs.copyFileSync(RELEASE_SCRIPT, fixtureReleaseScript);
    fs.chmodSync(fixtureReleaseScript, 0o755);

    // Commit scripts to main and push so clone is clean and origin/main matches
    runGit(["add", "scripts/bokli_deploy.sh", "scripts/bokli_release.sh"], cloneDir);
    runGit(["commit", "-m", "Add deploy and release scripts"], cloneDir);
    runGit(["push", "origin", "main"], cloneDir);
  });

  afterEach(() => {
    if (fixtureDir && fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("refuses if tag argument is missing", () => {
    const res = runDeploy(fixtureDeployScript, [], {}, cloneDir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
  });

  it("refuses if tag does not exist locally after fetch", () => {
    const res = runDeploy(
      fixtureDeployScript,
      ["v9.9.9"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v9.9.9' does not exist locally after fetch.");
  });

  it("refuses if tag diverges from origin/main", () => {
    // Tag the earlier commit (HEAD~1)
    const initialCommitSha = runGit(["rev-parse", "HEAD~1"], cloneDir).trim();
    runGit(["tag", "-a", "v0.9.0-diverged", initialCommitSha, "-m", "Divergent tag"], cloneDir);
    runGit(["push", "origin", "v0.9.0-diverged"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["v0.9.0-diverged"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v0.9.0-diverged'");
    expect(res.stderr).toContain("does not match origin/main");
    expect(res.stderr).toContain("requires the release tag to point to the current tip of origin/main");
  });

  it("refuses if working tree is dirty, printing what is dirty", () => {
    // Tag current tip of origin/main
    runGit(["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"], cloneDir);
    runGit(["push", "origin", "v1.0.0"], cloneDir);

    // Create uncommitted dirty changes
    fs.writeFileSync(path.join(cloneDir, "uncommitted_file.txt"), "dirty state\n");

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: working tree is dirty.");
    expect(res.stderr).toContain("Dirty files:");
    expect(res.stderr).toContain("uncommitted_file.txt");
  });

  it("succeeds when clean tree and tag == origin/main tip (with test seams / skip guards)", () => {
    // Tag current tip of origin/main
    runGit(["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"], cloneDir);
    runGit(["push", "origin", "v1.0.0"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
        BOKLI_DEPLOY_HEALTHCHECK_CMD: "echo 200",
      },
      cloneDir
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("==> Fetching origin...");
    expect(res.stdout).toContain("==> Checking out v1.0.0...");
    expect(res.stdout).toContain("Skipping build (BOKLI_DEPLOY_SKIP_BUILD=1)");
    expect(res.stdout).toContain("Skipping restart (BOKLI_DEPLOY_SKIP_RESTART=1)");
    expect(res.stdout).toContain("✅ deployed v1.0.0, /login returns 200");

    // Verify checked out commit matches tag commit
    const currentSha = runGit(["rev-parse", "HEAD"], cloneDir).trim();
    const tagSha = runGit(["rev-parse", "v1.0.0^{commit}"], cloneDir).trim();
    expect(currentSha).toBe(tagSha);
  });

  it("fails health check when /login returns non-200, giving hint to check journalctl", () => {
    // Tag current tip of origin/main
    runGit(["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"], cloneDir);
    runGit(["push", "origin", "v1.0.0"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
        BOKLI_DEPLOY_HEALTHCHECK_CMD: "echo 500",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ FAIL: deployed v1.0.0, but /login returned HTTP 500 (expected 200).");
    expect(res.stderr).toContain("journalctl --user -u bokli");
  });

  it("bokli_release.sh handles missing arguments and dry run", () => {
    // Missing arguments
    const missingRes = spawnSync(fixtureReleaseScript, [], { cwd: cloneDir, encoding: "utf-8" });
    expect(missingRes.status).toBe(1);
    expect(missingRes.stderr).toContain("Usage:");

    // Dry run
    const dryRunRes = spawnSync(fixtureReleaseScript, ["v2.0.0", "Release v2.0.0"], {
      cwd: cloneDir,
      env: {
        ...process.env,
        BOKLI_RELEASE_DRY_RUN: "1",
      },
      encoding: "utf-8",
    });
    expect(dryRunRes.status).toBe(0);
    expect(dryRunRes.stdout).toContain("Creating annotated tag 'v2.0.0' on origin/main");
    expect(dryRunRes.stdout).toContain("Dry run active");

    // Verify tag was created locally on origin/main tip
    const tagSha = runGit(["rev-parse", "v2.0.0^{commit}"], cloneDir).trim();
    const mainSha = runGit(["rev-parse", "origin/main^{commit}"], cloneDir).trim();
    expect(tagSha).toBe(mainSha);
  });
});
