import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real .githooks/pre-commit in a throwaway repo that shares this checkout's
// eslint.config.mjs and node_modules.
const root = path.resolve(import.meta.dirname, "../..");
const hook = path.join(root, ".githooks/pre-commit");
let dir;

const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const commit = () => {
  const r = spawnSync("git", ["commit", "-qm", "test"], { cwd: dir, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
};
const write = (file, text) => writeFileSync(path.join(dir, file), text);
const read = (file) => readFileSync(path.join(dir, file), "utf8");
const committed = (file) => git("show", `HEAD:${file}`);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "bokli-hook-"));
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.invalid");
  git("config", "core.hooksPath", ".githooks");
  mkdirSync(path.join(dir, ".githooks"));
  copyFileSync(hook, path.join(dir, ".githooks/pre-commit"));
  copyFileSync(path.join(root, "eslint.config.mjs"), path.join(dir, "eslint.config.mjs"));
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  write(".gitignore", "node_modules\n");
  write("old.ts", "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base", "--no-verify");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("pre-commit hook", { timeout: 60_000 }, () => {
  it("fixes and re-stages a fixable issue, including filenames with spaces", () => {
    write("my file.ts", "let x = 1;\nexport default x;\n");
    git("add", "my file.ts");
    expect(commit().status).toBe(0);
    expect(committed("my file.ts")).toContain("const x = 1;");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("blocks on an error ESLint can't fix", () => {
    write("bad.ts", "export const y: any = 1;\n");
    git("add", "bad.ts");
    const r = commit();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no-explicit-any");
  });

  it("blocks on a warning, like CI's --max-warnings=0", () => {
    write("warn.ts", "const unused = 1;\nexport {};\n");
    git("add", "warn.ts");
    expect(commit().status).not.toBe(0);
  });

  it("leaves commits without lintable files alone, including deletions", () => {
    write("notes.md", "let x = 1;\n");
    git("add", "notes.md");
    git("rm", "-q", "old.ts");
    expect(commit().status).toBe(0);
  });

  it("checks but never auto-stages a partially staged file", () => {
    write("old.ts", "let b = 1;\nexport default b;\n");
    git("add", "old.ts");
    write("old.ts", "let b = 1;\nexport default b;\n// unstaged\n");
    const r = commit();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unstaged changes");
    expect(git("diff", "--cached")).not.toContain("unstaged");
    expect(read("old.ts")).toContain("let b = 1;");
  });

  it("commits a partially staged file whose staged part is clean", () => {
    write("old.ts", "export const a = 2;\n");
    git("add", "old.ts");
    write("old.ts", "export const a = 2;\n// unstaged\n");
    expect(commit().status).toBe(0);
    expect(committed("old.ts")).not.toContain("unstaged");
  });

  it("treats filenames literally: no glob expansion, no option parsing", () => {
    write("a*.ts", "let g = 1;\nexport default g;\n");
    write("another.ts", "untracked\n");
    write("--opt.ts", "export const o = 1;\n");
    git("add", "--", ":(literal)a*.ts", "--opt.ts");
    expect(commit().status).toBe(0);
    expect(committed("a*.ts")).toContain("const g = 1;");
    expect(git("ls-files", "another.ts")).toBe("");
  });

  it("never fixes through a staged symlink", () => {
    write("target.ts", "let t = 1;\nexport default t;\n");
    symlinkSync("target.ts", path.join(dir, "link.ts"));
    git("add", "link.ts");
    expect(commit().status).toBe(0);
    expect(read("target.ts")).toContain("let t = 1;");
  });

  it("lints a staged regular file whose working copy is now a symlink", () => {
    write("bad.ts", "export const y: any = 1;\n");
    git("add", "bad.ts");
    rmSync(path.join(dir, "bad.ts"));
    symlinkSync("old.ts", path.join(dir, "bad.ts"));
    expect(commit().status).not.toBe(0);
  });

  it("lints a symlink replaced by a regular file", () => {
    symlinkSync("old.ts", path.join(dir, "link.ts"));
    git("add", "link.ts");
    git("commit", "-qm", "link", "--no-verify");
    rmSync(path.join(dir, "link.ts"));
    write("link.ts", "export const y: any = 1;\n");
    git("add", "link.ts");
    expect(commit().status).not.toBe(0);
  });

  it("npm's prepare script turns the hook on in a fresh clone", () => {
    git("config", "--unset", "core.hooksPath");
    const { prepare } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
    execFileSync("sh", ["-c", prepare], { cwd: dir });
    expect(git("config", "--local", "core.hooksPath").trim()).toBe(".githooks");
  });
});
