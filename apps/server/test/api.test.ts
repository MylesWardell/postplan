import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createTRPCClient, httpLink } from "@trpc/client";
import { accounts, createApiKey, schema, seedAccounts } from "@postplan/database";
import type { AppRouter } from "@postplan/api";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createSessionCookie } from "../src/auth/session.js";

test("tRPC and REST share draft ownership, versions, storage and session boundaries", async () => {
  const postgres = new PGlite();
  const db = drizzle(postgres, { schema });
  const objects = new Map<string, string>();
  const originalConfig = { ...config };
  let failStorage = false;
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../../packages/database/drizzle", import.meta.url),
    ),
  });
  await seedAccounts(db, "owner-key");
  await db.insert(accounts).values({ id: "other", name: "Other" });
  const otherKey = await createApiKey(db, "other", "other-key");
  const app = createApp({
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
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    config.publicBaseUrl = base;
    config.sessionSecret = "test-session-secret";
    const client = (token?: string, headers: Record<string, string> = {}) =>
      createTRPCClient<AppRouter>({
        links: [
          httpLink({
            url: `${base}/trpc`,
            headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
          }),
        ],
      });
    const owner = client("owner-key");
    const other = client(otherKey.token);
    const anonymous = client();
    const html = "<!doctype html><html><head><title>Draft</title></head><body>Résumé</body></html>";
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    await assert.rejects(anonymous.drafts.list.query(), /Sign in/);
    const upload = await owner.drafts.upload.mutate({ html, description: "Original" });
    assert.equal(upload.ok, true);
    if (!upload.ok) throw new Error("Upload failed");
    const { draftId } = upload;
    assert.equal(await (await fetch(upload.publicUrl)).text(), html);
    assert.equal(await (await fetch(upload.rawUrl)).text(), html);
    const raw = await fetch(upload.rawUrl);
    assert.match(raw.headers.get("content-security-policy") ?? "", /script-src 'none'/);
    assert.equal(raw.headers.get("x-postplan-draft-version"), "1");
    assert.equal((await owner.drafts.list.query()).drafts[0]?.description, "Original");
    const listed = await fetch(`${base}/api/drafts`, {
      headers: { authorization: "Bearer owner-key" },
    });
    assert.equal(listed.status, 200);
    assert.equal(
      ((await listed.json()) as { drafts: { draftId: string }[] }).drafts[0]?.draftId,
      draftId,
    );
    await assert.rejects(other.drafts.detail.query({ draftId }), /Draft not found/);
    await assert.rejects(
      other.drafts.update.mutate({ draftId, title: "Stolen" }),
      /Draft not found/,
    );
    await assert.rejects(other.drafts.delete.mutate({ draftId }), /Draft not found/);
    await assert.rejects(other.drafts.upload.mutate({ html, draftId }), /Draft not found/);
    assert.equal((await other.drafts.list.query()).drafts.length, 0);
    const updated = await fetch(`${base}/api/uploads`, {
      method: "POST",
      headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
      body: JSON.stringify({ html, draftId }),
    });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as { versionNumber: number }).versionNumber, 2);
    await owner.drafts.update.mutate({ draftId, title: "Renamed", description: null });
    const detail = await owner.drafts.detail.query({ draftId });
    assert.equal(detail.draft.title, "Renamed");
    assert.equal(detail.draft.description, null);
    assert.equal(detail.versions.length, 2);
    await owner.drafts.disable.mutate({ draftId });
    assert.equal((await fetch(upload.publicUrl)).status, 404);
    assert.equal((await fetch(`${base}/d/${draftId}/v/1/raw`)).status, 404);
    await owner.drafts.enable.mutate({ draftId });
    assert.equal((await fetch(`${base}/d/${draftId}/v/1/raw`)).status, 200);
    const cookie = createSessionCookie({
      accountId: "acct_bootstrap",
      accountName: "Bootstrap Account",
      email: null,
      pictureUrl: null,
    }).split(";")[0]!;
    const session = client(undefined, { cookie, origin: base });
    await session.drafts.update.mutate({ draftId, description: "From frontend" });
    assert.equal(
      (await session.drafts.detail.query({ draftId })).draft.description,
      "From frontend",
    );
    await assert.rejects(
      client(undefined, { cookie, origin: "https://evil.example" }).drafts.delete.mutate({
        draftId,
      }),
      /application origin/,
    );
    await assert.rejects(
      client(undefined, { cookie }).drafts.delete.mutate({ draftId }),
      /application origin/,
    );
    await assert.rejects(
      client("invalid", { cookie, origin: base }).drafts.list.query(),
      /Invalid API key/,
    );
    assert.equal((await fetch(`${base}/api/drafts`, { headers: { cookie } })).status, 401);
    assert.equal((await anonymous.drafts.upload.mutate({ html })).ok, true);
    assert.equal((await owner.drafts.upload.mutate({ html: "<form></form>" })).ok, false);
    const before = (await owner.drafts.detail.query({ draftId })).versions.length;
    failStorage = true;
    await assert.rejects(owner.drafts.upload.mutate({ html, draftId }), /Internal server error/);
    failStorage = false;
    assert.equal((await owner.drafts.detail.query({ draftId })).versions.length, before);
    const key = await owner.apiKeys.create.mutate({ name: "temporary" });
    await assert.rejects(
      other.apiKeys.revoke.mutate({ apiKeyId: key.apiKey.id }),
      /API key not found/,
    );
    await owner.apiKeys.revoke.mutate({ apiKeyId: key.apiKey.id });
    await assert.rejects(client(key.token).account.me.query(), /Invalid API key/);
    for (let i = 0; i < 9; i++) await owner.apiKeys.create.mutate({ name: "Rate test" });
    await assert.rejects(
      owner.apiKeys.create.mutate({ name: "Over limit" }),
      /Rate limit exceeded/,
    );
    assert.equal(
      (
        await fetch(`${base}/api/api-keys`, {
          method: "POST",
          headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      429,
    );
    await owner.drafts.delete.mutate({ draftId });
    assert.equal((await fetch(upload.publicUrl)).status, 404);
    assert.equal((await owner.drafts.list.query()).drafts.length, 0);
  } finally {
    Object.assign(config, originalConfig);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await postgres.close();
  }
});
