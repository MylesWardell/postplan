import { statement } from "@postplan/store-drizzle/database";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { beforeEach, afterEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createCloudflareStore, createDatabase } from "../src/database";
import {
  accounts,
  apiKeys,
  identities,
  draftVersions,
  uploadEvents,
} from "@postplan/store-drizzle/schema";
import type { UploadContext } from "@postplan/store";
import migration from "../../store-drizzle/drizzle/0000_same_vulcan.sql?raw";
import { assertSqliteDatabase } from "../src/configuration";
import applicationSchema from "../deploy/schema.sql?raw";
import { applicationStorage } from "../src/application-storage";
import { cleanup } from "../src/cleanup";

test("Cloudflare only accepts SQLite", () => {
  expect(() => assertSqliteDatabase(undefined)).not.toThrow();
  expect(() => assertSqliteDatabase("sqlite")).not.toThrow();
  for (const selected of ["dynamodb", "sqlite,dynamodb", "", "postgres"]) {
    expect(() => assertSqliteDatabase(selected)).toThrow("must be sqlite");
  }
});

beforeEach(async () => {
  await env.POSTPLAN_DB.batch(
    migration
      .split("--> statement-breakpoint")
      .filter((statement) => statement.trim())
      .map((statement) => env.POSTPLAN_DB.prepare(statement)),
  );
  await env.POSTPLAN_DB.batch(
    applicationSchema
      .split(";")
      .filter((s) => s.trim())
      .map((s) => env.POSTPLAN_DB.prepare(s)),
  );
});
afterEach(() => reset());

test("expired drafts stop serving before bounded cleanup removes objects and preserves reservations", async () => {
  const { store, context, db } = await fixture();
  const storage = applicationStorage(env.POSTPLAN_DB, env.HTML_BUCKET);
  const result = await store.drafts.upload({
    context: { ...context, putHtml: (key, html) => storage.putHtml(key, html) },
    input: { html: "<!doctype html><title>Expiry</title><p>Old</p>" },
  });
  if (!result.ok) {
    throw new Error("Upload failed");
  }
  await db.update(draftVersions).set({ createdAt: new Date(Date.now() - 100 * 86400000) });
  expect((await store.drafts.findPublicVersion({ draftId: result.draftId })).draft).toBeNull();
  const now = Date.now();
  await cleanup(env, now);
  expect((await env.HTML_BUCKET.list()).objects).toHaveLength(1);
  await cleanup(env, now + 60001);
  expect((await env.HTML_BUCKET.list()).objects).toHaveLength(0);
  expect(await db.select().from(draftVersions)).toHaveLength(0);
  expect(
    await env.POSTPLAN_DB.prepare("SELECT writes FROM application_budget").first("writes"),
  ).toBe(1);
});

async function fixture() {
  const { store } = createCloudflareStore(env);
  await store.initialize({ bootstrapKey: "d1-test" });
  const context: UploadContext = {
    apiKey: await store.accounts.findApiKey({ token: "d1-test" }),
    sourceIp: "192.0.2.1",
    userAgent: "test",
    requestId: "test",
    maxHtmlBytes: 512 * 1024,
    publicBaseUrl: "https://plans.example.com",
    requestBaseUrl: "https://plans.example.com",
    putHtml: async () => {},
  };
  return { store, context, db: createDatabase(env.POSTPLAN_DB) };
}

test("D1 shares account lifecycle and preserves identity under concurrent first logins", async () => {
  const { store, db } = await fixture();
  await store.initialize({ bootstrapKey: "d1-test" });
  expect(await store.accounts.findApiKey({ token: "postplan-public-upload-sentinel" })).toBeNull();
  const key = await store.accounts.createApiKey({ accountId: "acct_bootstrap", name: "Test" });
  expect(await store.accounts.findApiKey({ token: key.token })).not.toBeNull();
  expect(await store.accounts.revokeApiKey({ accountId: "other", id: key.apiKey.id })).toBe(false);
  expect(
    await store.accounts.revokeApiKey({ accountId: "acct_bootstrap", id: key.apiKey.id }),
  ).toBe(true);
  expect(await store.accounts.findApiKey({ token: key.token })).toBeNull();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      store.accounts.findOrCreateIdentity({
        provider: "test",
        subject: "user",
        profile: { piiSubject: "stable", email: "test@example.com" },
      }),
    ),
  );
  expect(new Set(results.map((row) => row.accountId)).size).toBe(1);
  expect(await db.select().from(accounts)).toHaveLength(3);
  const updated = await store.accounts.findOrCreateIdentity({ provider: "test", subject: "user" });
  expect(updated.email).toBeNull();
  expect((await db.select().from(identities))[0]?.piiSubject).toBe("stable");
});

test("D1 serializes version allocation, latest pointers and typed metadata", async () => {
  const { store, context } = await fixture();
  const input = {
    html: "<!doctype html><title>Versions</title><p>Content</p>",
    metadata: { gitDirty: true },
  };
  const first = await store.drafts.upload({ context, input });
  if (!first.ok) {
    throw new Error("Upload failed");
  }
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      store.drafts.upload({ context, input: { ...input, draftId: first.draftId } }),
    ),
  );
  expect(results.map((row) => (row.ok ? row.versionNumber : -1)).sort((a, b) => a - b)).toEqual([
    2, 3, 4, 5, 6, 7,
  ]);
  const { drafts: listed } = await store.drafts.list({
    accountId: "acct_bootstrap",
    context,
    limit: 10,
    status: "all",
  });
  expect(listed[0]?.latestVersionNumber).toBe(7);
  expect(listed[0]?.versionCount).toBe(7);
  expect(listed[0]?.createdAt).toBeInstanceOf(Date);
  expect(await store.drafts.totals({ accountId: "acct_bootstrap" })).toEqual({
    drafts: 1,
    published: 1,
    versions: 7,
  });
  const found = await store.drafts.findPublicVersion({ draftId: first.draftId });
  expect(found.version?.gitDirty).toBe(true);
  expect(found.version?.externalImageHosts).toEqual([]);
});

test("D1 rejects ownership/deletion races and rolls back every dependent write", async () => {
  const { store, context, db } = await fixture();
  const input = { html: "<!doctype html><title>Race</title><p>Content</p>" };
  const first = await store.drafts.upload({ context, input });
  if (!first.ok) {
    throw new Error("Upload failed");
  }
  await expect(
    store.drafts.upload({
      context: { ...context, apiKey: null },
      input: { ...input, draftId: first.draftId },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    store.drafts.upload({
      context: {
        ...context,
        putHtml: async () => {
          await store.drafts.update({
            accountId: "acct_bootstrap",
            draftId: first.draftId,
            values: { deletedAt: new Date() },
          });
        },
      },
      input: { ...input, draftId: first.draftId },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.select().from(draftVersions)).toHaveLength(1);
  expect(await db.select().from(uploadEvents)).toHaveLength(1);
  await expect(
    db.atomic([
      statement(db.insert(accounts).values({ id: "rollback", name: "Rollback" })),
      statement(
        db.insert(apiKeys).values({ id: "bad", name: "Bad", accountId: "missing", keyHash: "bad" }),
      ),
    ]),
  ).rejects.toThrow();
  expect(await db.select().from(accounts).where(eq(accounts.id, "rollback"))).toHaveLength(0);
});

test("the shared store delegates rate limits to Durable Objects", async () => {
  const { store } = createCloudflareStore(env);
  const input = { namespace: "upload", key: "client", rule: { window: 60_000, maxRequests: 2 } };
  expect((await store.rateLimit(input)).success).toBe(true);
  expect((await createCloudflareStore(env).store.rateLimit(input)).success).toBe(true);
  expect((await store.rateLimit(input)).success).toBe(false);
});
