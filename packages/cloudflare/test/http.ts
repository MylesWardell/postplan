import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { z } from "zod";

// Deliberately local-only: these checks create application records.
const base = "http://localhost:5173";
const token = "local-application-test";
const html = "<!doctype html><title>Connector acceptance</title><p>Local only â€” ä¸–ç•Œ</p>";
const upload = z.object({
  ok: z.literal(true),
  draftId: z.string(),
  versionNumber: z.number(),
  publicUrl: z.string(),
});
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  bearer: string | null = token,
) {
  return fetch(base + path, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.20",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
}
assert.equal((await request("/api/uploads", "POST", { html }, null)).status, 401);
const firstResponse = await request("/api/uploads", "POST", { html });
assert.equal(firstResponse.status, 201);
const first = upload.parse(await firstResponse.json());
const next = upload.parse(
  await (await request("/api/uploads", "POST", { html, draftId: first.draftId })).json(),
);
assert.equal(next.versionNumber, 2);
const publicPath = new URL(first.publicUrl).pathname;
for (const path of [publicPath, `${publicPath}/v/1`, `${publicPath}/raw`]) {
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), html);
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'none'/);
}
assert.equal((await request(publicPath, "HEAD")).status, 200);
const listed = await request("/api/drafts");
assert.match(await listed.text(), new RegExp(first.draftId));
const payload = Buffer.from(
  JSON.stringify({
    accountId: "acct_bootstrap",
    accountName: "Owner",
    exp: Math.floor(Date.now() / 1000) + 60,
  }),
).toString("base64url");
const cookie = `postplan_session=${payload}.${createHmac("sha256", "local-session-only").update(payload).digest("base64url")}`;
const dashboard = await fetch(base + "/dashboard", { headers: { cookie }, redirect: "manual" });
assert.equal(dashboard.status, 200);
assert.match(await dashboard.text(), /Connector acceptance/);
assert.match(dashboard.headers.get("content-security-policy") || "", /nonce-/);
const key = z
  .object({ token: z.string(), apiKey: z.object({ id: z.string() }) })
  .parse(await (await request("/api/api-keys", "POST", { name: "connector-test" })).json());
assert.equal((await request("/api/me", "GET", undefined, key.token)).status, 200);
assert.equal((await request(`/api/api-keys/${key.apiKey.id}/revoke`, "POST", {})).status, 200);
assert.equal((await request("/api/me", "GET", undefined, key.token)).status, 401);
assert.equal((await request(`/api/drafts/${first.draftId}/disable`, "POST", {})).status, 200);
assert.equal((await request(publicPath)).status, 404);
assert.equal((await request(`/api/drafts/${first.draftId}/enable`, "POST", {})).status, 200);
assert.equal((await request(publicPath)).status, 200);
assert.equal((await request(`/api/drafts/${first.draftId}`, "DELETE")).status, 200);
assert.equal((await request(publicPath)).status, 404);
assert.equal((await request("/api/uploads", "POST", { html, draftId: first.draftId })).status, 404);
assert.equal(
  (await request("/api/uploads", "POST", { html: "x".repeat(2 * 1024 * 1024) })).status,
  413,
);
console.log(
  "Cloudflare application acceptance passed: auth, uploads, versions, R2, dashboard session/CSP, key revocation, disable/enable/delete, body bounds.",
);
