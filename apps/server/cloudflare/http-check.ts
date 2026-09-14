import assert from "node:assert/strict";
import { z } from "zod";

const base = process.env.POSTPLAN_EXPERIMENT_URL || "http://localhost:5173";
const token = process.env.EXPERIMENT_TOKEN;
assert(token, "Set EXPERIMENT_TOKEN for the protected probe.");
const request = (path: string, init?: RequestInit) =>
  fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(30_000) });
const home = await request("/");
assert.equal(home.status, 200);
assert(home.headers.get("content-security-policy")?.includes("nonce-"));
assert((await home.text()).includes("Good work deserves"));
const health = await request("/healthz");
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });
const spec = await request("/api/spec.json");
assert.equal(spec.status, 200);
z.object({ openapi: z.string() }).parse(await spec.json());
const css = await request("/assets/styles.css");
assert.equal(css.status, 200);
await css.arrayBuffer();
const unavailable = await request("/dashboard");
assert.equal(unavailable.status, 503);
await unavailable.text();
const forbidden = await request("/__experiment/probe", {
  method: "POST",
  headers: { authorization: "Bearer wrong" },
});
assert.equal(forbidden.status, 404);
await forbidden.text();
const html = "<!doctype html><html><title>HTTP probe</title><body>Résumé — 世界</body></html>";
const measurements: { bytes: number; elapsedMs: number }[] = [];
for (const body of [
  html,
  html.replace(
    "</body>",
    "x".repeat(512 * 1024 - new TextEncoder().encode(html).length) + "</body>",
  ),
]) {
  const response = await request("/__experiment/probe", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/html" },
    body,
  });
  assert.equal(response.status, 200);
  const result = z
    .object({ ok: z.literal(true), bytes: z.number(), elapsedMs: z.number() })
    .parse(await response.json());
  assert.equal(result.ok, true);
  measurements.push({ bytes: result.bytes, elapsedMs: result.elapsedMs });
}
const oversized = await request("/__experiment/probe", {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: "x".repeat(512 * 1024 + 1),
});
assert.equal(oversized.status, 413);
await oversized.text();
console.log(
  JSON.stringify({
    ok: true,
    base,
    checks: [
      "SSR and CSP",
      "D1 health",
      "oRPC OpenAPI",
      "static CSS",
      "disabled data routes",
      "probe authentication",
      "small and maximum-size HTML",
      "oversize rejection",
    ],
    measurements,
    note: "elapsedMs is wall time, not Cloudflare CPU time",
  }),
);
