import assert from "node:assert/strict";

import { test, expect } from "vitest";

import type { Store, UploadContext, UploadInput } from "@postplan/store";
import { cleanupPlans } from "@postplan/store-dynamodb/cleanup";
import { findDynamoPublicVersion, claimExpiredPlan } from "@postplan/store-dynamodb/dynamo-drafts";
import type { DynamoPlan } from "@postplan/store-dynamodb/dynamo-drafts";
import { DynamoRateLimiter } from "@postplan/store-dynamodb/dynamo-rate-limit";

import { dynamoFixture, dynamoEndpoint } from "./fixture";

test.skipIf(!dynamoEndpoint)(
  "DynamoDB transactions, revocation, shared limits and retention cleanup",
  async () => {
    let now = Date.UTC(2026, 0, 1);
    let days = 90;
    const { db, store, close } = await dynamoFixture(
      () => now,
      () => days,
    );
    const objects = new Map<string, { html: string; modifiedAt: number }>();
    try {
      await store.accounts.seed({ bootstrapKey: "dynamo-owner" });
      const context: UploadContext = {
        apiKey: await store.accounts.findApiKey({ token: "dynamo-owner" }),
        putHtml: async (key, html) => {
          objects.set(key, { html, modifiedAt: now });
        },
        requestBaseUrl: "https://plans.example.com",
        sourceIp: "127.0.0.1",
        userAgent: null,
        requestId: null,
        maxHtmlBytes: 512 * 1024,
      };
      const upload = uploader(store, context);
      const html = "<!doctype html><title>Dynamo</title><p>Hello</p>";
      const first = await upload({ html });
      expect(first.ok).toBe(true);
      const id = first.draftId;
      const concurrent = await Promise.all(
        Array.from({ length: 6 }, () => upload({ html, draftId: id })),
      );
      expect(concurrent.map((x) => x.versionNumber).toSorted((a, b) => a - b)).toEqual([
        2, 3, 4, 5, 6, 7,
      ]);
      expect(
        (await store.drafts.detail({ accountId: "acct_bootstrap", draftId: id, context }))!
          .versions[0]?.versionNumber,
      ).toBe(7);
      expect(
        (
          await store.drafts.list({
            accountId: "acct_bootstrap",
            context,
            limit: 10,
            status: "all",
          })
        ).drafts[0]?.latestVersionNumber,
      ).toBe(7);
      const identities = await Promise.all(
        Array.from({ length: 4 }, () =>
          store.accounts.findOrCreateIdentity({ provider: "test", subject: "same-user" }),
        ),
      );
      expect(new Set(identities.map((x) => x.accountId)).size).toBe(1);
      const other = await store.accounts.createApiKey({
        accountId: identities[0]!.accountId,
        name: "other",
      });
      expect(await store.accounts.findApiKey({ token: other.token })).not.toBeNull();
      expect(
        await store.accounts.revokeApiKey({
          accountId: identities[0]!.accountId,
          id: other.apiKey.id,
        }),
      ).toBe(true);
      expect(await store.accounts.findApiKey({ token: other.token })).toBeNull();

      const limiterA = new DynamoRateLimiter(db, "test", { maxRequests: 3, window: 1000 });
      const limiterB = new DynamoRateLimiter(db, "test", { maxRequests: 3, window: 1000 });
      const limits = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? limiterA : limiterB).limit("same")),
      );
      expect(limits.filter((x) => x.success)).toHaveLength(3);
      now += 1000;
      expect((await limiterA.limit("same")).success).toBe(true);

      now += 89 * 86400_000;
      await upload({ html, draftId: id });
      await upload({ html, draftId: id });
      await upload({ html, draftId: id });
      expect(
        await db.query({
          TableName: db.tables.records,
          ConsistentRead: true,
          Limit: 2,
          KeyConditionExpression: "draftId = :id AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":id": id, ":prefix": "VERSION#" },
        }),
      ).toHaveLength(10);
      const fresh = await db.get<DynamoPlan>(db.tables.plans, { draftId: id });
      const staleSnapshot = {
        ...fresh!,
        lastUploadedAt: fresh!.lastUploadedAt - 90 * 86400,
        revision: fresh!.revision - 1,
      };
      expect(await claimExpiredPlan(db, staleSnapshot)).toBe(false);
      now += 2 * 86400_000;
      expect((await findDynamoPublicVersion(db, id, 1)).version?.versionNumber).toBe(1);
      days = 1;
      expect((await findDynamoPublicVersion(db, id)).draft).toBeNull();
      expect(
        (
          await store.drafts.list({
            accountId: "acct_bootstrap",
            context,
            limit: 10,
            status: "all",
          })
        ).drafts,
      ).toHaveLength(0);
      expect(await store.drafts.totals({ accountId: "acct_bootstrap" })).toEqual({
        drafts: 0,
        published: 0,
        versions: 0,
      });
      await assert.rejects(upload({ html, draftId: id }), /not found/);
      days = 0;
      expect((await findDynamoPublicVersion(db, id)).draft).not.toBeNull();
      days = 1;

      let failDelete = false;
      const storage = {
        async deletePrefix(prefix: string) {
          if (failDelete) {
            const firstKey = [...objects.keys()].find((key) => key.startsWith(prefix));
            if (firstKey) {
              objects.delete(firstKey);
            }
            throw new Error("Injected S3 deletion failure");
          }
          for (const key of objects.keys()) {
            if (key.startsWith(prefix)) {
              objects.delete(key);
            }
          }
        },
        async listObjects() {
          return {
            objects: [...objects].map(([key, value]) => ({ key, modifiedAt: value.modifiedAt })),
          };
        },
        async deleteObject(key: string) {
          objects.delete(key);
        },
      };
      await cleanupPlans(db, storage);
      expect((await db.get<DynamoPlan>(db.tables.plans, { draftId: id }))?.state).toBe("DELETING");
      days = 0;
      expect((await findDynamoPublicVersion(db, id)).draft).toBeNull();
      now += 86400_000;
      failDelete = true;
      await assert.rejects(cleanupPlans(db, storage), /Injected/);
      expect((await db.get<DynamoPlan>(db.tables.plans, { draftId: id }))?.state).toBe("DELETING");
      failDelete = false;
      await cleanupPlans(db, storage);
      expect(objects.size).toBe(0);
      const tombstone = await db.get<DynamoPlan>(db.tables.plans, { draftId: id });
      expect(tombstone?.state).toBe("DELETED");
      expect(tombstone?.ttlAt).toBe(Math.floor(now / 1000) + 7 * 86400);
      expect(
        await db.query({
          TableName: db.tables.records,
          KeyConditionExpression: "draftId = :id",
          ExpressionAttributeValues: { ":id": id },
        }),
      ).toHaveLength(0);
      await cleanupPlans(db, storage);
      expect((await db.get<DynamoPlan>(db.tables.plans, { draftId: id }))?.ttlAt).toBeDefined();
    } finally {
      await close();
    }
  },
  30_000,
);

test.skipIf(!dynamoEndpoint)(
  "abandoned uploads cannot publish after their lease and are reconciled without expiring active plans",
  async () => {
    let now = Date.UTC(2026, 0, 1);
    const { db, store, close } = await dynamoFixture(
      () => now,
      () => 0,
    );
    const objects = new Map<string, number>();
    let mode: "ok" | "fail" | "late" = "ok";
    try {
      await store.accounts.seed({ bootstrapKey: "intent-owner" });
      const upload = uploader(store, {
        apiKey: await store.accounts.findApiKey({ token: "intent-owner" }),
        putHtml: async (key) => {
          if (mode === "fail") {
            throw new Error("Injected upload failure");
          }
          objects.set(key, now);
          if (mode === "late") {
            now += 301_000;
          }
        },
        requestBaseUrl: "https://plans.example.com",
        sourceIp: "127.0.0.1",
        userAgent: null,
        requestId: null,
        maxHtmlBytes: 512 * 1024,
      });
      const html = "<!doctype html><title>Intent</title><p>Hello</p>";
      const first = await upload({ html });
      mode = "fail";
      await assert.rejects(upload({ html, draftId: first.draftId }), /Injected/);
      mode = "late";
      await assert.rejects(upload({ html, draftId: first.draftId }), /not found/);
      await assert.rejects(upload({ html }), /not found/);
      expect(objects.size).toBe(3);
      now += 86400_000;
      const storage = {
        async deletePrefix(prefix: string) {
          for (const key of objects.keys()) {
            if (key.startsWith(prefix)) {
              objects.delete(key);
            }
          }
        },
        async deleteObject(key: string) {
          objects.delete(key);
        },
        async listObjects() {
          return { objects: [...objects].map(([key, modifiedAt]) => ({ key, modifiedAt })) };
        },
      };
      await cleanupPlans(db, storage);
      expect(objects.size).toBe(1);
      const intents = await db.query<{ status: string }>({
        TableName: db.tables.records,
        ConsistentRead: true,
        KeyConditionExpression: "draftId = :id AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":id": first.draftId, ":prefix": "INTENT#" },
      });
      expect(intents).toHaveLength(1);
      expect(intents[0]?.status).toBe("COMMITTED");
      expect((await findDynamoPublicVersion(db, first.draftId)).version?.versionNumber).toBe(1);
      now += 86400_000;
      await cleanupPlans(db, storage);
      expect(objects.size).toBe(1);
    } finally {
      await close();
    }
  },
  30_000,
);

function uploader(store: Store, context: UploadContext) {
  return async (input: UploadInput) => {
    const result = await store.drafts.upload({ context, input });
    assert.ok(result.ok);
    return result;
  };
}
