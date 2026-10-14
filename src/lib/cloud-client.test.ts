import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Sent = { method: string; url: string; key: string | null; actor: string | null };
let sent: Sent[];
let replies: ((r: Request) => Response | Promise<Response>)[];
beforeEach(() => {
  vi.resetModules();
  sent = [];
  replies = [];
  vi.stubGlobal("location", { origin: "https://bokli.test" });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(new URL(String(input instanceof Request ? input.url : input), "https://bokli.test"), input instanceof Request ? input : init);
    if (r.url.endsWith("/api/cloud-v1/identity")) return Response.json({ id: 7, role: "Operator" });
    sent.push({ method: r.method, url: r.url.replace("https://bokli.test", ""), key: r.headers.get("Idempotency-Key"), actor: r.headers.get("X-Bokli-Actor-Id") });
    return replies.shift()!(r);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const lost = () => { throw new TypeError("Failed to fetch"); };
const save = (apiFetch: typeof import("./cloud-client").apiFetch, cashSen: number) =>
  apiFetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-10-01", cashSen, costLines: [] }) });

it("leaves the laptop build on plain /api fetches", async () => {
  const { apiFetch } = await import("./cloud-client");
  replies.push(() => Response.json({ ok: true }));
  await apiFetch("/api/sheets", { method: "POST", body: "{}" });
  expect(sent).toEqual([{ method: "POST", url: "/api/sheets", key: null, actor: null }]);
});

it("keeps one key per draft and asks status before resending an unknown save", async () => {
  vi.stubEnv("BOKLI_TARGET", "cloud");
  const { apiFetch } = await import("./cloud-client");
  replies.push(lost, lost); // reply and status check both lost
  const first = await save(apiFetch, 100);
  expect(first.status).toBe(503);
  expect(await first.json()).toMatchObject({ code: "outcomeUnknown" });
  const key = sent[0].key;
  expect(key).toBeTruthy();
  expect(sent.map((s) => s.actor)).toEqual(["7", "7"]);

  replies.push(() => Response.json({ saved: true, status: 201, result: { sheet: { id: 1 } } }));
  const again = await save(apiFetch, 100);
  expect(again.status).toBe(201);
  expect(await again.json()).toEqual({ sheet: { id: 1 } });
  expect(sent[2]).toMatchObject({ method: "GET", url: `/api/cloud-v1/operations/status?operation=sheet.save&operationId=${key}` });
  expect(sent).toHaveLength(3); // nothing re-sent

  replies.push(() => Response.json({ sheet: { id: 1 } }, { status: 201 }));
  await save(apiFetch, 200);
  expect(sent[3]).toMatchObject({ method: "POST", url: "/api/cloud-v1/sheets" });
  expect(sent[3].key).not.toBe(key);
});

it("sends the same key again for an unchanged draft whose save was not stored", async () => {
  vi.stubEnv("BOKLI_TARGET", "cloud");
  const { apiFetch } = await import("./cloud-client");
  replies.push(lost, lost);
  await save(apiFetch, 100);
  replies.push(() => Response.json({ saved: false }), () => Response.json({ sheet: { id: 1 } }, { status: 201 }));
  expect((await save(apiFetch, 100)).status).toBe(201);
  expect(sent[3]).toMatchObject({ method: "POST", key: sent[0].key });
});

it("keeps the caller's own Idempotency-Key", async () => {
  vi.stubEnv("BOKLI_TARGET", "cloud");
  const { apiFetch } = await import("./cloud-client");
  replies.push(() => Response.json({ expense: { id: 1 } }, { status: 201 }));
  await apiFetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "stored-key" }, body: "{}" });
  expect(sent[0]).toMatchObject({ url: "/api/cloud-v1/expenses", key: "stored-key", actor: "7" });
});
