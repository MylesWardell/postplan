import {
  evictDurableObject,
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";

import { cloudflareGateway } from "../src/gateway";
import { r2Storage } from "../src/r2";
import { limiterName, validateRule } from "../src/rate-limit";
import { handleCloudflareRequest } from "../src/request-pipeline";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

test("gateway preserves body/origin and removes forged proxy metadata", async () => {
  const result = cloudflareGateway(
    new Request("https://plans.example.com/api?q=1", {
      method: "POST",
      body: "payload",
      headers: {
        "cf-connecting-ip": "2001:db8::1",
        "cf-ray": "edge-id",
        "x-real-ip": "forged",
        "x-forwarded-for": "forged",
        "x-amzn-request-context": "forged",
        "x-request-id": "forged",
      },
    }),
    { publicBaseUrl: "https://*.plans.example.com", requestIdHeader: "x-request-id" },
  );
  expect(result.peerIp).toBe("2001:db8::1");
  expect(result.request.url).toBe("https://plans.example.com/api?q=1");
  expect(await result.request.text()).toBe("payload");
  expect(result.request.headers.get("x-amzn-request-context")).toBeNull();
  expect(result.request.headers.get("x-real-ip")).toBeNull();
  expect(result.request.headers.get("x-request-id")).toBe("edge-id");
});

test("gateway rejects foreign hosts, nested draft names, plaintext and invalid IPs", () => {
  const options = { publicBaseUrl: "https://*.plans.example.com", requestIdHeader: "x-request-id" };
  for (const url of [
    "https://evil.example/",
    "https://plans.example.com.evil.example/",
    "https://api.plans.example.com/",
    "http://plans.example.com/",
    "https://plans.example.com:444/",
  ]) {
    expect(() => cloudflareGateway(new Request(url), options)).toThrow();
  }
  expect(() =>
    cloudflareGateway(
      new Request("https://plans.example.com/", { headers: { "cf-connecting-ip": "forged" } }),
      options,
    ),
  ).toThrow();
  expect(
    cloudflareGateway(new Request("https://abcdefghijkl.plans.example.com/api"), options).draftHost,
  ).toBe(true);
});

test("Cloudflare logs only failures with bounded metadata, not credentials", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await handleCloudflareRequest(
    new Request("http://foreign.example/private", {
      headers: { authorization: "Bearer secret", "cf-ray": "failure-ray" },
    }),
    env,
    async () => new Response("unused"),
  );
  expect(response.status).toBe(400);
  expect(warning).toHaveBeenCalledOnce();
  const record = JSON.parse(String(warning.mock.calls[0]![0]));
  expect(record).toEqual({
    event: "request_failure",
    method: "GET",
    path: "/private",
    status: 400,
    requestId: "failure-ray",
    clientIp: null,
  });
  expect(warning.mock.calls[0]![0]).not.toContain("secret");

  const serverFailure = await handleCloudflareRequest(
    new Request("http://localhost:5173/healthz"),
    env,
    async () => new Response("failed", { status: 503 }),
  );
  expect(serverFailure.status).toBe(503);
  expect(error).toHaveBeenCalledOnce();

  const success = await handleCloudflareRequest(
    new Request("http://localhost:5173/healthz"),
    env,
    async () => new Response("ok"),
  );
  expect(success.status).toBe(200);
  expect(warning).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledOnce();
});

test("D1 rolls back failed batches; zero-row predicates do not abort later statements", async () => {
  const db = env.POSTPLAN_DB;
  await db.exec("CREATE TABLE probe (id TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK(used >= 0))");
  await expect(
    db.batch([
      db.prepare("INSERT INTO probe VALUES ('a', 1)"),
      db.prepare("INSERT INTO probe VALUES ('b', -1)"),
    ]),
  ).rejects.toThrow();
  expect(await db.prepare("SELECT count(*) AS n FROM probe").first("n")).toBe(0);
  await db.batch([
    db.prepare("UPDATE probe SET used=2 WHERE id='absent'"),
    db.prepare("INSERT INTO probe VALUES ('a', 1)"),
  ]);
  expect(await db.prepare("SELECT used FROM probe WHERE id='a'").first("used")).toBe(1);
});

test("D1 conditional capacity reservation never exceeds the budget under concurrency", async () => {
  const db = env.POSTPLAN_DB;
  await db.exec(
    "CREATE TABLE budget (id INTEGER PRIMARY KEY, used INTEGER NOT NULL); INSERT INTO budget VALUES (1, 0)",
  );
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      db.prepare("UPDATE budget SET used=used+1 WHERE id=1 AND used<5 RETURNING used").all(),
    ),
  );
  expect(results.filter((result) => result.results.length > 0)).toHaveLength(5);
  expect(await db.prepare("SELECT used FROM budget").first("used")).toBe(5);
});

test("R2 round-trips bounded unicode HTML and removes it", async () => {
  const storage = r2Storage(env.HTML_BUCKET);
  const html = "<!doctype html><html><title>Plan</title><body>Résumé — 世界 🌏</body></html>";
  await storage.putHtml("experiment.html", html);
  const body = await storage.getHtml("experiment.html");
  expect(body).toBeInstanceOf(ReadableStream);
  expect(await new Response(body).text()).toBe(html);
  expect((await env.HTML_BUCKET.head("experiment.html"))?.httpMetadata?.cacheControl).toBe(
    "no-store",
  );
  await env.HTML_BUCKET.delete("experiment.html");
  await expect(storage.getHtml("experiment.html")).rejects.toThrow("not found");
});

test("limiter subjects are private, independent and share atomic counters", async () => {
  const rule = { window: 60_000, maxRequests: 3 };
  const name = limiterName("secret", "upload", "192.0.2.1", rule);
  expect(name).not.toContain("192.0.2.1");
  expect(name).not.toBe(limiterName("secret", "key-mint", "192.0.2.1", rule));
  const first = env.RATE_LIMITS.getByName(name);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => env.RATE_LIMITS.getByName(name).limit(rule)),
  );
  expect(results.filter((result) => result.success)).toHaveLength(3);
  expect((await first.limit(rule)).remaining).toBe(0);
  expect((await env.RATE_LIMITS.getByName("other").limit(rule, 3)).success).toBe(true);
  expect((await first.limit(rule, 4)).success).toBe(false);
  expect(() => validateRule(rule, 0)).toThrow();
  await evictDurableObject(first);
  expect((await env.RATE_LIMITS.getByName(name).limit(rule)).success).toBe(false);
});

test("an early alarm preserves the active counter and an expired alarm deletes state", async () => {
  const stub = env.RATE_LIMITS.getByName("alarm");
  const rule = { window: 60_000, maxRequests: 1 };
  await stub.limit(rule);
  await runDurableObjectAlarm(stub);
  expect((await stub.limit(rule)).success).toBe(false);
  await runInDurableObject(stub, (_object, state) => {
    state.storage.sql.exec("UPDATE counter SET reset=0");
  });
  await runDurableObjectAlarm(stub);
  expect((await stub.limit(rule)).success).toBe(true);
});
