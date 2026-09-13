import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts/verify_build_stamp.sh");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "scripts/bokli_deploy.sh");

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runVerify(repoDir) {
  return spawnSync(VERIFY_SCRIPT, [], {
    cwd: repoDir,
    encoding: "utf-8",
  });
}

function writeStamp(repoDir, fields) {
  const content = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(path.join(repoDir, ".next-prod/BUILD_MANIFEST"), content + "\n");
}

describe("scripts/verify_build_stamp.sh static verification", () => {
  it("verify script exists, is executable, and passes bash -n; deploy script still passes bash -n", () => {
    expect(fs.existsSync(VERIFY_SCRIPT)).toBe(true);
    expect(() => fs.accessSync(VERIFY_SCRIPT, fs.constants.X_OK)).not.toThrow();
    for (const script of [VERIFY_SCRIPT, DEPLOY_SCRIPT]) {
      const check = spawnSync("bash", ["-n", script], { encoding: "utf-8" });
      expect(check.status).toBe(0);
      expect(check.stderr).toBe("");
    }
  });

  it("deploy/bokli.service has ExecStartPre verify_build_stamp before ExecStart", () => {
    const unit = fs.readFileSync(path.join(REPO_ROOT, "deploy/bokli.service"), "utf-8");
    const preIdx = unit.indexOf("ExecStartPre=");
    const startIdx = unit.indexOf("ExecStart=");
    expect(preIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeLessThan(startIdx);
    expect(unit).toContain("ExecStartPre=%h/projects/bokli/scripts/verify_build_stamp.sh");
    // EnvironmentFile line stays before ExecStartPre
    const envIdx = unit.indexOf("EnvironmentFile=");
    expect(envIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeLessThan(preIdx);
  });
});

describe("scripts/verify_build_stamp.sh behavior on temp fixture repo", () => {
  let fixtureDir;
  let repoDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-stamp-fixture-"));
    repoDir = path.join(fixtureDir, "repo");
    fs.mkdirSync(repoDir);
    runGit(["init", "-b", "main"], repoDir);
    runGit(["config", "user.email", "stamp-test@example.com"], repoDir);
    runGit(["config", "user.name", "Stamp Test"]);
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Fixture\n");
    runGit(["add", "README.md"], repoDir);
    runGit(["commit", "-m", "init"], repoDir);
    runGit(["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"], repoDir);
    fs.mkdirSync(path.join(repoDir, ".next-prod"));
  });

  afterEach(() => {
    if (fixtureDir && fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("fails when stamp file is missing", () => {
    const res = runVerify(repoDir);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("build stamp file not found");
    expect(res.stderr).toContain("run ./scripts/bokli_deploy.sh <tag>");
  });

  it("passes with a valid stamp matching HEAD and existing tag", () => {
    const head = runGit(["rev-parse", "HEAD"], repoDir).trim();
    writeStamp(repoDir, {
      TAG: "v1.0.0",
      COMMIT: head,
      BUILT_AT: "2026-09-14T00:00:00Z",
      DEPLOYED_BY: "bokli_deploy.sh",
    });
    const res = runVerify(repoDir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Build stamp OK");
  });

  it("fails when stamp COMMIT is stale (does not match HEAD)", () => {
    writeStamp(repoDir, {
      TAG: "v1.0.0",
      COMMIT: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      BUILT_AT: "2026-09-14T00:00:00Z",
      DEPLOYED_BY: "bokli_deploy.sh",
    });
    const res = runVerify(repoDir);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("does not match checked-out HEAD");
  });

  it("fails when stamp TAG does not exist in the repo", () => {
    const head = runGit(["rev-parse", "HEAD"], repoDir).trim();
    writeStamp(repoDir, {
      TAG: "v9.9.9-fake",
      COMMIT: head,
      BUILT_AT: "2026-09-14T00:00:00Z",
      DEPLOYED_BY: "bokli_deploy.sh",
    });
    const res = runVerify(repoDir);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("does not exist as a tag");
  });

  it("fails when a required field is empty/missing or DEPLOYED_BY is wrong", () => {
    const head = runGit(["rev-parse", "HEAD"], repoDir).trim();

    writeStamp(repoDir, { TAG: "v1.0.0", COMMIT: head, DEPLOYED_BY: "bokli_deploy.sh" });
    expect(runVerify(repoDir).status).not.toBe(0);

    writeStamp(repoDir, { COMMIT: head, BUILT_AT: "x", DEPLOYED_BY: "bokli_deploy.sh" });
    expect(runVerify(repoDir).status).not.toBe(0);

    writeStamp(repoDir, {
      TAG: "v1.0.0",
      COMMIT: head,
      BUILT_AT: "x",
      DEPLOYED_BY: "someone-else",
    });
    const res = runVerify(repoDir);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("DEPLOYED_BY");
  });
});
