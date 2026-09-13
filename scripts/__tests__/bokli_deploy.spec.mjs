import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "scripts/bokli_deploy.sh");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts/verify_build_stamp.sh");

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

function startMockHttpServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        if (req.url === "/login") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("OK");
        } else {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("ERR");
        }
      });
      server.listen(0, "127.0.0.1", () => {
        console.log(server.address().port);
      });
    `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    child.stdout.once("data", (data) => {
      const port = data.toString().trim();
      resolve({
        port,
        close: () => child.kill(),
      });
    });

    child.on("error", reject);
  });
}

function writeBuildStamp(cloneDir, tag, commitOverride) {
  const commit = commitOverride || runGit(["rev-parse", "HEAD"], cloneDir).trim();
  fs.mkdirSync(path.join(cloneDir, ".next-prod"), { recursive: true });
  fs.writeFileSync(
    path.join(cloneDir, ".next-prod/BUILD_MANIFEST"),
    `TAG=${tag}\nCOMMIT=${commit}\nBUILT_AT=2026-01-01T00:00:00Z\nDEPLOYED_BY=bokli_deploy.sh\n`
  );
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
  let fixtureDir;
  let bareOriginDir;
  let cloneDir;
  let fixtureDeployScript;

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

    // Initial commit (Commit 1: ancestor with scripts)
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Test Repo\n");
    fs.mkdirSync(path.join(cloneDir, "scripts"), { recursive: true });
    fixtureDeployScript = path.join(cloneDir, "scripts/bokli_deploy.sh");
    fs.copyFileSync(DEPLOY_SCRIPT, fixtureDeployScript);
    fs.chmodSync(fixtureDeployScript, 0o755);
    const fixtureVerifyScript = path.join(cloneDir, "scripts/verify_build_stamp.sh");
    fs.copyFileSync(VERIFY_SCRIPT, fixtureVerifyScript);
    fs.chmodSync(fixtureVerifyScript, 0o755);

    runGit(["add", "README.md", "scripts/bokli_deploy.sh", "scripts/verify_build_stamp.sh"], cloneDir);
    runGit(["commit", "-m", "Initial commit on main with scripts"], cloneDir);
    runGit(["push", "-u", "origin", "main"], cloneDir);

    // Second commit on main (Commit 2: current origin/main tip)
    fs.appendFileSync(path.join(cloneDir, "README.md"), "More updates\n");
    runGit(["add", "README.md"], cloneDir);
    runGit(["commit", "-m", "Update README on main"], cloneDir);
    runGit(["push", "origin", "main"], cloneDir);
  });

  afterEach(() => {
    if (fixtureDir && fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("refuses if tag argument is missing or unknown option given", () => {
    const resNoArg = runDeploy(fixtureDeployScript, [], {}, cloneDir);
    expect(resNoArg.status).toBe(1);
    expect(resNoArg.stderr).toContain("Usage:");

    const resUnknown = runDeploy(fixtureDeployScript, ["--invalid-flag", "v1.0.0"], {}, cloneDir);
    expect(resUnknown.status).toBe(1);
    expect(resUnknown.stderr).toContain("Unknown option: --invalid-flag");
  });

  it("refuses if tag contains invalid characters (injection defense)", () => {
    const res = runDeploy(fixtureDeployScript, ["v1.0.0;malicious"], {}, cloneDir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: invalid tag format 'v1.0.0;malicious'");

    const resNewline = runDeploy(fixtureDeployScript, ["v1.0.0\ninjected=1"], {}, cloneDir);
    expect(resNewline.status).toBe(1);
    expect(resNewline.stderr).toContain("❌ Refusing deploy: invalid tag format");
  });

  it("refuses if tag does not exist locally after fetch", () => {
    const res = runDeploy(
      fixtureDeployScript,
      ["v9.9.9"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v9.9.9' does not exist locally after fetch.");
  });

  it("refuses ancestor tag if --allow-rollback is NOT provided", () => {
    // Tag the earlier commit (HEAD~1)
    const initialCommitSha = runGit(["rev-parse", "HEAD~1"], cloneDir).trim();
    runGit(["tag", "-a", "v0.9.0-ancestor", initialCommitSha, "-m", "Earlier release"], cloneDir);
    runGit(["push", "origin", "v0.9.0-ancestor"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["v0.9.0-ancestor"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing deploy: tag 'v0.9.0-ancestor'");
    expect(res.stderr).toContain("does not match origin/main tip");
    expect(res.stderr).toContain("To roll back to a previously released ancestor tag, re-run with: --allow-rollback");
  });

  it("allows rollback when tag is an ancestor of origin/main tip and --allow-rollback is given", () => {
    // Tag the earlier commit (HEAD~1)
    const initialCommitSha = runGit(["rev-parse", "HEAD~1"], cloneDir).trim();
    runGit(["tag", "-a", "v0.9.0-rollback", initialCommitSha, "-m", "Earlier release"], cloneDir);
    runGit(["push", "origin", "v0.9.0-rollback"], cloneDir);

    writeBuildStamp(cloneDir, "v0.9.0-rollback", initialCommitSha);
    const res = runDeploy(
      fixtureDeployScript,
      ["--allow-rollback", "v0.9.0-rollback"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("⚠️  Rollback allowed: tag 'v0.9.0-rollback'");
    expect(res.stdout).toContain("is a valid ancestor of origin/main");
    expect(res.stdout).toContain("==> Checking out v0.9.0-rollback...");

    // Verify checked out commit matches ancestor commit
    const currentSha = runGit(["rev-parse", "HEAD"], cloneDir).trim();
    expect(currentSha).toBe(initialCommitSha);
  });

  it("refuses rollback even with --allow-rollback if tag is NOT an ancestor of origin/main", () => {
    // Create a divergent branch with a commit not in main
    runGit(["checkout", "-b", "divergent-branch"], cloneDir);
    fs.writeFileSync(path.join(cloneDir, "divergent.txt"), "divergent content\n");
    runGit(["add", "divergent.txt"], cloneDir);
    runGit(["commit", "-m", "Divergent branch commit"], cloneDir);
    runGit(["tag", "-a", "v0.9.0-unrelated", "-m", "Divergent tag"], cloneDir);
    runGit(["push", "origin", "v0.9.0-unrelated"], cloneDir);

    // Switch back to main
    runGit(["checkout", "main"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["--allow-rollback", "v0.9.0-unrelated"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("❌ Refusing rollback: tag 'v0.9.0-unrelated'");
    expect(res.stderr).toContain("is not an ancestor of origin/main");
    expect(res.stderr).toContain("Rollback is only allowed for commits that exist in origin/main's history.");
  });

  it("untracked files do NOT block deploy, but modified tracked files DO block deploy", () => {
    // Tag current tip of origin/main
    runGit(["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"], cloneDir);
    runGit(["push", "origin", "v1.0.0"], cloneDir);
    writeBuildStamp(cloneDir, "v1.0.0");

    // Create untracked file (simulating .next-prod or build artifacts)
    fs.writeFileSync(path.join(cloneDir, "untracked_artifact.tmp"), "temporary artifact\n");

    const resUntracked = runDeploy(
      fixtureDeployScript,
      ["v1.0.0"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(resUntracked.status).toBe(0);
    expect(resUntracked.stdout).toContain("==> Checking out v1.0.0...");

    // Now modify a tracked file
    fs.appendFileSync(path.join(cloneDir, "README.md"), "\nlocal modification\n");

    const resTracked = runDeploy(
      fixtureDeployScript,
      ["v1.0.0"],
      {
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(resTracked.status).toBe(1);
    expect(resTracked.stderr).toContain("❌ Refusing deploy: working tree has modified tracked files.");
    expect(resTracked.stderr).toContain("Dirty tracked files:");
    expect(resTracked.stderr).toContain("README.md");
  });

  it("skips migrate, build, restart, and healthcheck when SKIP seams are set", () => {
    runGit(["tag", "-a", "v1.0.0-skip", "-m", "Release v1.0.0-skip"], cloneDir);
    runGit(["push", "origin", "v1.0.0-skip"], cloneDir);
    writeBuildStamp(cloneDir, "v1.0.0-skip");

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0-skip"],
      {
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Skipping database migrations (BOKLI_DEPLOY_SKIP_MIGRATE=1)");
    expect(res.stdout).toContain("Skipping build (BOKLI_DEPLOY_SKIP_BUILD=1)");
    expect(res.stdout).toContain("Skipping restart (BOKLI_DEPLOY_SKIP_RESTART=1)");
    expect(res.stdout).toContain("Health check skipped (BOKLI_DEPLOY_SKIP_HEALTHCHECK=1)");
  });

  it("full deploy flow writes valid .next-prod/BUILD_MANIFEST with expected fields", () => {
    runGit(["tag", "-a", "v1.0.0-manifest", "-m", "Release v1.0.0-manifest"], cloneDir);
    runGit(["push", "origin", "v1.0.0-manifest"], cloneDir);
    fs.mkdirSync(path.join(cloneDir, ".next-prod"), { recursive: true });

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0-manifest"],
      {
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_BUILD_CMD: "true",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

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
  });

  it("refuses deploy when SKIP_BUILD is set but no build stamp exists", () => {
    runGit(["tag", "-a", "v1.0.0-nostamp", "-m", "Release v1.0.0-nostamp"], cloneDir);
    runGit(["push", "origin", "v1.0.0-nostamp"], cloneDir);

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0-nostamp"],
      {
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Refusing restart: build skipped (BOKLI_DEPLOY_SKIP_BUILD=1) but no build stamp exists");
  });

  it("refuses deploy when SKIP_BUILD is set but build stamp is stale or points to different commit", () => {
    runGit(["tag", "-a", "v1.0.0-stale", "-m", "Release v1.0.0-stale"], cloneDir);
    runGit(["push", "origin", "v1.0.0-stale"], cloneDir);
    // Write stamp with a mismatched commit
    writeBuildStamp(cloneDir, "v1.0.0-stale", "0123456789abcdef0123456789abcdef01234567");

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0-stale"],
      {
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Refusing restart: build was skipped but the existing build stamp does not match HEAD/tag");
  });

  it("refuses deploy when SKIP_BUILD is set and build stamp has an empty required field", () => {
    runGit(["tag", "-a", "v1.0.0-emptyfield", "-m", "Release v1.0.0-emptyfield"], cloneDir);
    runGit(["push", "origin", "v1.0.0-emptyfield"], cloneDir);
    fs.mkdirSync(path.join(cloneDir, ".next-prod"), { recursive: true });
    // Write stamp with empty TAG=
    fs.writeFileSync(
      path.join(cloneDir, ".next-prod/BUILD_MANIFEST"),
      `TAG=\nCOMMIT=${runGit(["rev-parse", "HEAD"], cloneDir).trim()}\nBUILT_AT=2026-01-01T00:00:00Z\nDEPLOYED_BY=bokli_deploy.sh\n`
    );

    const res = runDeploy(
      fixtureDeployScript,
      ["v1.0.0-emptyfield"],
      {
        BOKLI_DEPLOY_SKIP_MIGRATE: "1",
        BOKLI_DEPLOY_SKIP_BUILD: "1",
        BOKLI_DEPLOY_SKIP_RESTART: "1",
        BOKLI_DEPLOY_SKIP_HEALTHCHECK: "1",
        BOKLI_DEPLOY_SKIP_SLEEP: "1",
      },
      cloneDir
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Refusing restart: build was skipped but the existing build stamp does not match HEAD/tag");
  });

  it("performs health check curl with BOKLI_DEPLOY_HEALTHCHECK_URL against a local server", async () => {
    runGit(["tag", "-a", "v1.0.0-health", "-m", "Release v1.0.0-health"], cloneDir);
    runGit(["push", "origin", "v1.0.0-health"], cloneDir);
    writeBuildStamp(cloneDir, "v1.0.0-health");

    const mockServer = await startMockHttpServer();
    try {
      const resSuccess = runDeploy(
        fixtureDeployScript,
        ["v1.0.0-health"],
        {
          BOKLI_DEPLOY_SKIP_MIGRATE: "1",
          BOKLI_DEPLOY_SKIP_BUILD: "1",
          BOKLI_DEPLOY_SKIP_RESTART: "1",
          BOKLI_DEPLOY_SKIP_SLEEP: "1",
          BOKLI_DEPLOY_HEALTHCHECK_URL: `http://127.0.0.1:${mockServer.port}/login`,
        },
        cloneDir
      );

      expect(resSuccess.status).toBe(0);
      expect(resSuccess.stdout).toContain("✅ deployed v1.0.0-health, /login returns 200");

      const resFail = runDeploy(
        fixtureDeployScript,
        ["v1.0.0-health"],
        {
          BOKLI_DEPLOY_SKIP_MIGRATE: "1",
          BOKLI_DEPLOY_SKIP_BUILD: "1",
          BOKLI_DEPLOY_SKIP_RESTART: "1",
          BOKLI_DEPLOY_SKIP_SLEEP: "1",
          BOKLI_DEPLOY_HEALTHCHECK_URL: `http://127.0.0.1:${mockServer.port}/broken-endpoint`,
        },
        cloneDir
      );

      expect(resFail.status).toBe(1);
      expect(resFail.stderr).toContain("❌ FAIL: deployed v1.0.0-health, but http://127.0.0.1");
      expect(resFail.stderr).toContain("returned HTTP 500 (expected 200 after 3 attempts).");
      expect(resFail.stderr).toContain("journalctl --user -u bokli");
    } finally {
      mockServer.close();
    }
  });
});
