/** Fail closed before starting workerd if the test config gains external storage. */
export function assertLocalD1TestConfig(options: unknown): void {
  const workers = options as Record<string, unknown> | undefined;
  const mf = workers?.miniflare as Record<string, unknown> | undefined;
  const bindings = mf?.bindings as Record<string, unknown> | undefined;
  const workerKeys = ["singleWorker", "isolatedStorage", "remoteBindings", "miniflare"];
  const mfKeys = ["compatibilityDate", "d1Databases", "bindings"];
  if (
    !workers || !mf || !bindings ||
    workers.singleWorker !== true || workers.isolatedStorage !== true || workers.remoteBindings !== false ||
    Object.keys(workers).some((key) => !workerKeys.includes(key)) ||
    Object.keys(mf).some((key) => !mfKeys.includes(key)) ||
    !Array.isArray(mf.d1Databases) || mf.d1Databases.length !== 1 || mf.d1Databases[0] !== "BOKLI_TEST_DB" ||
    Object.keys(bindings).length !== 1 || !Array.isArray(bindings.TEST_MIGRATIONS)
  ) {
    throw new Error("Local D1 tests require the explicit synthetic binding, isolated storage, no remote bindings and no persistence overrides");
  }
}
