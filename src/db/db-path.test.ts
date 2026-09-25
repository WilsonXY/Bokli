import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb, openDb, resolveDbPath } from "./index";

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("resolveDbPath", () => {
  it("resolves BOKLI_DB_PATH to an absolute path when set", () => {
    const target = path.join(os.tmpdir(), "bokli-path-test", "bokli.db");
    expect(resolveDbPath(env({ BOKLI_DB_PATH: target }))).toBe(path.resolve(target));
  });

  it("resolves a relative BOKLI_DB_PATH against cwd", () => {
    expect(resolveDbPath(env({ BOKLI_DB_PATH: "data-dev/bokli.db" }))).toBe(
      path.resolve(process.cwd(), "data-dev/bokli.db"),
    );
  });

  it("throws when BOKLI_DB_PATH is unset (no fallback to ./data/bokli.db)", () => {
    expect(() => resolveDbPath(env({}))).toThrow(/BOKLI_DB_PATH is not set/);
  });

  it("throws when BOKLI_DB_PATH is empty", () => {
    expect(() => resolveDbPath(env({ BOKLI_DB_PATH: "" }))).toThrow(/BOKLI_DB_PATH is not set/);
  });

  it("throws when BOKLI_DB_PATH is whitespace-only", () => {
    expect(() => resolveDbPath(env({ BOKLI_DB_PATH: "   " }))).toThrow(/BOKLI_DB_PATH is not set/);
    expect(() => resolveDbPath(env({ BOKLI_DB_PATH: "\t\n" }))).toThrow(/BOKLI_DB_PATH is not set/);
  });

  it("trims surrounding whitespace from a valid BOKLI_DB_PATH", () => {
    expect(resolveDbPath(env({ BOKLI_DB_PATH: "  data-dev/bokli.db  " }))).toBe(
      path.resolve(process.cwd(), "data-dev/bokli.db"),
    );
  });
});

describe("db handles without BOKLI_DB_PATH", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("openDb/getDb/closeDb throw instead of opening a default database", () => {
    vi.stubEnv("BOKLI_DB_PATH", undefined);
    expect(() => openDb()).toThrow(/BOKLI_DB_PATH is not set/);
    expect(() => getDb()).toThrow(/BOKLI_DB_PATH is not set/);
    expect(() => closeDb()).toThrow(/BOKLI_DB_PATH is not set/);
  });
});

describe("drizzle.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses BOKLI_DB_PATH as the db url when set", async () => {
    const target = path.join(os.tmpdir(), "bokli-drizzle-test", "bokli.db");
    vi.stubEnv("BOKLI_DB_PATH", target);
    vi.resetModules();
    const { default: config } = await import("../../drizzle.config");
    expect(config).toMatchObject({ dbCredentials: { url: target } });
  });

  it("throws when BOKLI_DB_PATH is unset", async () => {
    vi.stubEnv("BOKLI_DB_PATH", undefined);
    vi.resetModules();
    await expect(import("../../drizzle.config")).rejects.toThrow(/BOKLI_DB_PATH is not set/);
  });
});
