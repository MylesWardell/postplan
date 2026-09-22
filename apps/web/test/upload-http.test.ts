import assert from "node:assert/strict";
import { gzipSync, deflateRawSync } from "node:zlib";

import { test } from "vitest";

import { config } from "#config";
import { createTestStore } from "@postplan/store/testing";

import { createServerOptions } from "./start-server";

test("Hono uploads preserve raw JSON, CORS, body bounds and rate-limit responses", async () => {
  const { store, close } = await createTestStore();
  const previous = { ...config, rateLimits: structuredClone(config.rateLimits) };
  const objects = new Map<string, string>();
  await store.accounts.seed({ bootstrapKey: "hono-upload-key" });
  config.allowAnonymousUploads = false;
  config.rateLimits.uploadKey = { maxRequests: 3, window: 60000 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...createServerOptions({
      store,
      putHtml: async (key, html) => {
        objects.set(key, html);
      },
      getHtml: async (key) => objects.get(key) ?? "",
    }),
  });
  try {
    const url = new URL("/api/uploads", server.url);
    config.publicBaseUrl = server.url.origin;
    const headers = {
      authorization: "Bearer hono-upload-key",
      "content-type": "application/json",
      origin: "https://client.example",
      [config.requestIdHeader]: "hono-test",
    };
    const send = (body: BodyInit, extra = {}) =>
      fetch(url, { method: "POST", headers: { ...headers, ...extra }, body });
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin: headers.origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Authorization/i);
    assert.equal((await send("{")).status, 400);
    assert.equal((await send(JSON.stringify({ filename: 123 }))).status, 400);
    assert.equal((await send("bad gzip", { "content-encoding": "gzip" })).status, 400);
    assert.equal(
      (
        await send(gzipSync(JSON.stringify({ html: "x".repeat(2 * 1024 * 1024) })), {
          "content-encoding": "gzip",
        })
      ).status,
      413,
    );
    assert.equal(objects.size, 0);
    const html = "<!doctype html><title>Hono</title><p>Direct upload</p>";
    const body = JSON.stringify({ html });
    assert.equal((await send(body, { authorization: "Bearer invalid" })).status, 401);
    for (const [payload, encoding] of [
      [body, "identity"],
      [gzipSync(body), "gzip"],
      [deflateRawSync(body), "deflate-raw"],
    ] as const) {
      const response = await send(payload, { "content-encoding": encoding });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("x-request-id"), "hono-test");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.versionNumber, 1);
      assert.equal(result.body, undefined);
    }
    assert.equal(objects.size, 3);
    const limited = await send(body);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("ratelimit-limit"), "3");
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(limited.headers.get("access-control-allow-origin"), "*");
    assert.equal((await limited.json()).code, "TOO_MANY_REQUESTS");
    assert.equal(objects.size, 3);
    assert.equal((await fetch(new URL("/api/me", server.url), { headers })).status, 200);
    assert.equal((await fetch(new URL("/api/spec.json", server.url))).status, 200);
  } finally {
    Object.assign(config, previous);
    await server.stop(true);
    await close();
  }
});
