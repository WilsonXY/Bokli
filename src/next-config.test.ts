import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import nextConfig, { resolveDistDir } from "../next.config";

describe("next.config distDir configuration", () => {
  it("resolves .next-prod when NODE_ENV is production", () => {
    expect(resolveDistDir({ NODE_ENV: "production" })).toBe(".next-prod");
  });

  it("resolves default .next when NODE_ENV is development", () => {
    expect(resolveDistDir({ NODE_ENV: "development" })).toBe(".next");
  });

  it("resolves default .next when NODE_ENV is unset or empty", () => {
    expect(resolveDistDir({})).toBe(".next");
  });

  it("honors BOKLI_BUILD_DIR override regardless of NODE_ENV", () => {
    expect(
      resolveDistDir({
        BOKLI_BUILD_DIR: ".custom-build",
        NODE_ENV: "production",
      })
    ).toBe(".custom-build");

    expect(
      resolveDistDir({
        BOKLI_BUILD_DIR: ".custom-dev",
        NODE_ENV: "development",
      })
    ).toBe(".custom-dev");
  });

  it(
    "evaluates default export distDir correctly in child processes for dev vs prod",
    () => {
      const rootDir = path.resolve(__dirname, "..");
      const tsxBin = path.resolve(rootDir, "node_modules/.bin/tsx");
      const evaluateScript = `
        import config from "./next.config.ts";
        process.stdout.write(config.distDir ?? "");
      `;

      const runWithEnv = (env: Record<string, string | undefined>) => {
        return execFileSync(
          tsxBin,
          ["-e", evaluateScript],
          {
            cwd: rootDir,
            env: {
              ...process.env,
              ...env,
            },
            encoding: "utf8",
          }
        ).trim();
      };

      expect(runWithEnv({ NODE_ENV: "production", BOKLI_BUILD_DIR: "" })).toBe(".next-prod");
      expect(runWithEnv({ NODE_ENV: "development", BOKLI_BUILD_DIR: "" })).toBe(".next");
      expect(runWithEnv({ NODE_ENV: "production", BOKLI_BUILD_DIR: ".custom-dist" })).toBe(".custom-dist");
    },
    15000
  );
});
