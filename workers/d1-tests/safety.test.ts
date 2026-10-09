import { expect, it } from "vitest";
import { assertLocalD1TestConfig } from "./safety";

const local = {
  singleWorker: true,
  isolatedStorage: true,
  remoteBindings: false,
  miniflare: { compatibilityDate: "2026-03-10", d1Databases: ["BOKLI_TEST_DB"], bindings: { TEST_MIGRATIONS: [] } },
};

it("refuses external configs, remote bindings, shared storage and persistence overrides", () => {
  const unsafe = [
    { ...local, wrangler: { configPath: "wrangler.toml" } },
    { ...local, remoteBindings: true },
    { ...local, remoteBindings: undefined },
    { ...local, isolatedStorage: false },
    { ...local, miniflare: { ...local.miniflare, d1Persist: "data/" } },
    { ...local, miniflare: { ...local.miniflare, d1Persist: "data-dev/" } },
    { ...local, miniflare: { ...local.miniflare, workers: [] } },
    { ...local, miniflare: { ...local.miniflare, d1Databases: ["DB"] } },
    { ...local, miniflare: { ...local.miniflare, d1Databases: [] } },
  ];
  for (const options of unsafe) {
    expect(() => assertLocalD1TestConfig(options)).toThrow("Local D1 tests require");
  }
  expect(() => assertLocalD1TestConfig(local)).not.toThrow();
});
