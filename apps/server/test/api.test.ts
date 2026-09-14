import { createDatabase } from "#db/client";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ORPCError, createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { accounts } from "#db/schema";
import { createApiKey, seedAccounts } from "#routers/account-store";
import { contract, type ApiClient } from "@postplan/api";
import { createServerOptions } from "./start-server.js";
import { config } from "#config";
import { createSessionCookie } from "#auth/session";

test("oRPC and REST share draft ownership, versions, storage and session boundaries", async () => {
  const { db, client: sqlite } = createDatabase(":memory:");
  const objects = new Map<string, string>();
  const originalConfig = { ...config };
  let failStorage = false;
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  await seedAccounts(db, "owner-key");
  await db.insert(accounts).values({ id: "other", name: "Other" });
  const otherKey = await createApiKey(db, "other", "other-key");
  const options = createServerOptions({
    db,
    putHtml: async (key, html) => {
      if (failStorage) throw new Error("Storage unavailable");
      objects.set(key, html);
    },
    getHtml: async (key) => {
      const html = objects.get(key);
      assert.ok(html);
      return html;
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...options,
  });
  try {
    const base = server.url.origin;
    config.publicBaseUrl = base;
    config.sessionSecret = "test-session-secret";
    const client = (token?: string, headers: Record<string, string> = {}) =>
      createORPCClient<ApiClient>(
        new OpenAPILink(contract, {
          origin: base,
          url: "/api",
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        }),
      );
    const owner = client("owner-key");
    const other = client(otherKey.token);
    const anonymous = client();
    const html = "<!doctype html><html><head><title>Draft</title></head><body>Résumé</body></html>";
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    await assert.rejects(anonymous.drafts.list(), /Sign in/);
    const { body: upload } = await owner.drafts.upload({ html, description: "Original" });
    assert.equal(upload.ok, true);
    if (!upload.ok) throw new Error("Upload failed");
    const { draftId } = upload;
    assert.equal(await (await fetch(upload.publicUrl)).text(), html);
    assert.equal(await (await fetch(upload.rawUrl)).text(), html);
    const raw = await fetch(upload.rawUrl);
    assert.match(raw.headers.get("content-security-policy") ?? "", /script-src 'none'/);
    assert.equal(raw.headers.get("x-postplan-draft-version"), "1");
    assert.equal((await owner.drafts.list()).drafts[0]?.description, "Original");
    const listed = await fetch(`${base}/api/drafts`, {
      headers: { authorization: "Bearer owner-key" },
    });
    assert.equal(listed.status, 200);
    assert.equal(
      ((await listed.json()) as { drafts: { draftId: string }[] }).drafts[0]?.draftId,
      draftId,
    );
    await assert.rejects(other.drafts.detail({ draftId }), /Draft not found/);
    await assert.rejects(other.drafts.update({ draftId, title: "Stolen" }), /Draft not found/);
    await assert.rejects(other.drafts.delete({ draftId }), /Draft not found/);
    await assert.rejects(other.drafts.upload({ html, draftId }), /Draft not found/);
    assert.equal((await other.drafts.list()).drafts.length, 0);
    const updated = await fetch(`${base}/api/uploads`, {
      method: "POST",
      headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
      body: JSON.stringify({ html, draftId }),
    });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as { versionNumber: number }).versionNumber, 2);
    await owner.drafts.update({ draftId, title: "Renamed", description: null });
    const detail = await owner.drafts.detail({ draftId });
    assert.equal(detail.draft.title, "Renamed");
    assert.equal(detail.draft.description, null);
    assert.equal(detail.versions.length, 2);
    await owner.drafts.disable({ draftId });
    assert.equal((await fetch(upload.publicUrl)).status, 404);
    assert.equal((await fetch(`${base}/d/${draftId}/v/1/raw`)).status, 404);
    await owner.drafts.enable({ draftId });
    assert.equal((await fetch(`${base}/d/${draftId}/v/1/raw`)).status, 200);
    const cookie = createSessionCookie({
      accountId: "acct_bootstrap",
      accountName: "Bootstrap Account",
      email: null,
      pictureUrl: null,
    }).split(";")[0]!;
    await assert.rejects(client(undefined, { cookie, origin: base }).drafts.list(), /Sign in/);
    assert.equal((await fetch(`${base}/ws/rpc`)).status, 404);
    await assert.rejects(
      client("invalid", { cookie, origin: base }).drafts.list(),
      /Invalid API key/,
    );
    assert.equal((await fetch(`${base}/api/drafts`, { headers: { cookie } })).status, 401);
    assert.equal((await anonymous.drafts.upload({ html })).body.ok, true);
    await assert.rejects(owner.drafts.upload({ html: "<form></form>" }), (error: unknown) => {
      assert.ok(error instanceof ORPCError);
      assert.equal(error.code, "UNPROCESSABLE_CONTENT");
      assert.match(error.message, /HTML validation failed/);
      assert.ok(error.data && typeof error.data === "object" && "errors" in error.data);
      return true;
    });
    const before = (await owner.drafts.detail({ draftId })).versions.length;
    failStorage = true;
    await assert.rejects(owner.drafts.upload({ html, draftId }), /Internal server error/i);
    failStorage = false;
    assert.equal((await owner.drafts.detail({ draftId })).versions.length, before);
    const key = await owner.apiKeys.create({ name: "temporary" });
    await assert.rejects(other.apiKeys.revoke({ apiKeyId: key.apiKey.id }), /API key not found/);
    const revokedClient = client(key.token);
    await revokedClient.account.me();
    await owner.apiKeys.revoke({ apiKeyId: key.apiKey.id });
    await assert.rejects(revokedClient.account.me(), /Invalid API key/);
    await assert.rejects(client(key.token).account.me(), /Invalid API key/);
    for (let i = 0; i < 9; i++) await owner.apiKeys.create({ name: "Rate test" });
    await assert.rejects(owner.apiKeys.create({ name: "Over limit" }), {
      code: "TOO_MANY_REQUESTS",
    });
    const limited = await fetch(`${base}/api/api-keys`, {
      method: "POST",
      headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("ratelimit-limit"), "10");
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
    const reset = Number(limited.headers.get("ratelimit-reset"));
    assert.ok(reset > Date.now());
    assert.ok(
      Math.abs(
        Number(limited.headers.get("retry-after")) - Math.ceil((reset - Date.now()) / 1000),
      ) <= 1,
    );
    await owner.drafts.delete({ draftId });
    assert.equal((await fetch(upload.publicUrl)).status, 404);
    assert.equal((await owner.drafts.list()).drafts.length, 0);
  } finally {
    Object.assign(config, originalConfig);
    await server.stop(true);
    sqlite.close();
  }
}, 30_000);
