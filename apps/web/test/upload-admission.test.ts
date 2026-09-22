import assert from "node:assert/strict";
import { gzipSync, deflateSync } from "node:zlib";

import { afterEach, beforeEach, test, vi } from "vitest";

import { config } from "#config";
import { createContextFactory } from "#context";
import { createUploadHandler } from "#lib/upload-http";
import { createTestStore } from "@postplan/store/testing";

let database: Awaited<ReturnType<typeof createTestStore>>;
const previous = { ...config };

beforeEach(async () => {
  database = await createTestStore();
  config.clientIpSource = "req-ip";
  config.apiGateway = false;
  config.trustProxy = false;
  await database.store.accounts.seed({ bootstrapKey: "upload-test" });
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.assign(config, previous);
  await database.close();
});

function setup(ipAllowed = true, keyAllowed = true) {
  const lookup = vi.fn(database.store.accounts.findApiKey);
  const upload = vi.fn(database.store.drafts.upload);
  const factory = createContextFactory({
    store: {
      ...database.store,
      accounts: { ...database.store.accounts, findApiKey: lookup },
      drafts: { ...database.store.drafts, upload },
    },
    putHtml: async () => {},
    getHtml: async () => "",
  });
  const ip = vi.fn(async () => ({
    success: ipAllowed,
    limit: 10,
    remaining: 5,
    reset: Date.now() + 60_000,
  }));
  const key = vi.fn(async () => ({
    success: keyAllowed,
    limit: 8,
    remaining: 3,
    reset: Date.now() + 60_000,
  }));
  const handler = createUploadHandler((...args) => {
    const base = factory(...args);
    base.rateLimiters["upload-ip"] = { limit: ip };
    base.rateLimiters["upload-key"] = { limit: key };
    return base;
  });
  return { handler, ip, key, lookup, upload };
}

function request(
  body: string | Uint8Array<ArrayBuffer>,
  encoding?: string,
  authorization: string | null = "Bearer upload-test",
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== null) {
    headers.set("authorization", authorization);
  }
  if (encoding) {
    headers.set("content-encoding", encoding);
  }
  return new Request("https://plans.example.com/api/uploads", { method: "POST", headers, body });
}

test.each([
  ["malformed JSON", "{", undefined],
  ["invalid schema", '{"filename":123}', undefined],
  ["invalid compression", "not gzip", "gzip"],
] as const)("meters IP and authenticated key for %s", async (_name, body, encoding) => {
  const { handler, ip, key, upload } = setup();
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await handler(request(body, encoding), "192.0.2.1");
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("RateLimit-Remaining"), "3");
  }
  assert.equal(ip.mock.calls.length, 4);
  assert.equal(key.mock.calls.length, 4);
  assert.equal(upload.mock.calls.length, 0);
  assert.deepEqual(ip.mock.calls[0], ["192.0.2.1"]);
  const auth = await database.store.accounts.findApiKey({ token: "upload-test" });
  assert.deepEqual(key.mock.calls[0], [auth!.id]);
});

test.each([null, "Bearer invalid", "Basic invalid"])(
  "rejects authentication %s before consuming the body",
  async (authorization) => {
    const { handler, ip, key } = setup();
    const req = request("not gzip", "gzip", authorization);
    assert.equal((await handler(req, "192.0.2.1")).status, 401);
    assert.equal(req.bodyUsed, false);
    assert.equal(ip.mock.calls.length, 1);
    assert.equal(key.mock.calls.length, 0);
  },
);

test.each(["ip", "key"])("rejects exceeded %s limit before consuming the body", async (limiter) => {
  const { handler, lookup, key } = setup(limiter !== "ip", limiter !== "key");
  const req = request("not gzip", "gzip");
  const response = await handler(req, "192.0.2.1");
  assert.equal(response.status, 429);
  assert.equal(req.bodyUsed, false);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(response.headers.get("RateLimit-Limit"), limiter === "ip" ? "10" : "8");
  assert.equal(lookup.mock.calls.length, limiter === "ip" ? 0 : 1);
  assert.equal(key.mock.calls.length, limiter === "ip" ? 0 : 1);
});

test.each(["gzip, gzip, gzip", "identity, identity, gzip", "br", "gzip, br"])(
  "rejects unsupported encoding %s before consuming the body",
  async (encoding) => {
    const { handler, ip, key } = setup();
    const req = request("invalid", encoding);
    assert.equal((await handler(req, null)).status, 415);
    assert.equal(req.bodyUsed, false);
    assert.equal(ip.mock.calls.length, 1);
    assert.equal(key.mock.calls.length, 1);
  },
);

test.each([false, true])("preserves the body cap (compressed: %s)", async (compressed) => {
  const { handler, upload } = setup();
  const body = "x".repeat(2 * 1024 * 1024 + 1);
  const req = request(compressed ? gzipSync(body) : body, compressed ? "gzip" : undefined);
  assert.equal((await handler(req, null)).status, 413);
  assert.equal(upload.mock.calls.length, 0);
});

test("caps intermediate decoded bodies", async () => {
  const { handler } = setup();
  const req = request(gzipSync("x".repeat(2 * 1024 * 1024 + 1)), "gzip, gzip");
  assert.equal((await handler(req, null)).status, 413);
});

test.each(["identity", "gzip", "gzip, deflate"])(
  "accepts supported encoding %s",
  async (encoding) => {
    const { handler } = setup();
    const json = JSON.stringify({ html: "<!doctype html><title>Test</title><p>Upload</p>" });
    const body =
      encoding === "identity"
        ? json
        : encoding === "gzip"
          ? gzipSync(json)
          : deflateSync(gzipSync(json));
    assert.equal((await handler(request(body, encoding), null)).status, 201);
  },
);
