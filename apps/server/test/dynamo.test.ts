import { test, expect } from "bun:test";
import { createContextFactory } from "#context";
import { createCaller } from "#client";
import {
  seedAccounts,
  findOrCreateAccountForIdentity,
  createApiKey,
  revokeApiKey,
  findApiKeyByToken,
} from "#routers/account-store";
import { findDynamoPublicVersion, claimExpiredPlan } from "@postplan/store-dynamodb/dynamo-drafts";
import type { DynamoPlan } from "@postplan/store-dynamodb/dynamo-drafts";
import { DynamoRateLimiter } from "@postplan/store-dynamodb/dynamo-rate-limit";
import { cleanupPlans } from "@postplan/store-dynamodb/cleanup";
import { parseRetentionDays, expired } from "#lib/retention";
import { dynamoFixture, dynamoEndpoint } from "./dynamo-fixture";
import { config } from "#config";

test("retention accepts configurable whole days and rejects invalid values", () => {
  expect(parseRetentionDays(undefined)).toBe(90);
  for (const value of ["0", "30", "365"]) {
    expect(parseRetentionDays(value)).toBe(Number(value));
  }
  for (const value of ["", " ", "-1", "0.5", "NaN", "Infinity", "1e2", "100000001"]) {
    expect(() => parseRetentionDays(value)).toThrow();
  }
  expect(expired(0, 90, 90 * 86400_000 - 1)).toBe(false);
  expect(expired(0, 90, 90 * 86400_000)).toBe(true);
  expect(expired(0, 0, 365 * 86400_000)).toBe(false);
});

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
    const previous = config.allowAnonymousUploads;
    config.allowAnonymousUploads = false;
    try {
      await seedAccounts(store, "dynamo-owner");
      const context = createContextFactory({
        store,
        putHtml: async (key, html) => {
          objects.set(key, { html, modifiedAt: now });
        },
        getHtml: async (key) => objects.get(key)!.html,
      });
      const caller = createCaller(
        context(
          new Request("https://plans.example.com", {
            headers: { authorization: "Bearer dynamo-owner" },
          }),
          "127.0.0.1",
          false,
        ),
      );
      const anonymous = createCaller(
        context(new Request("https://plans.example.com"), "127.0.0.2", false),
      );
      const html = "<!doctype html><title>Dynamo</title><p>Hello</p>";
      await expect(anonymous.drafts.upload({ html })).rejects.toThrow("API key");
      const { body: first } = await caller.drafts.upload({ html });
      expect(first.ok).toBe(true);
      const id = first.draftId;
      const concurrent = await Promise.all(
        Array.from({ length: 6 }, () => caller.drafts.upload({ html, draftId: id })),
      );
      expect(concurrent.map((x) => x.body.versionNumber).toSorted((a, b) => a - b)).toEqual([
        2, 3, 4, 5, 6, 7,
      ]);
      expect((await caller.drafts.detail({ draftId: id })).versions[0]?.versionNumber).toBe(7);
      expect((await caller.drafts.list()).drafts[0]?.latestVersionNumber).toBe(7);
      const identities = await Promise.all(
        Array.from({ length: 4 }, () =>
          findOrCreateAccountForIdentity(store, { provider: "test", subject: "same-user" }),
        ),
      );
      expect(new Set(identities.map((x) => x.accountId)).size).toBe(1);
      const other = await createApiKey(store, identities[0]!.accountId, "other");
      expect(await findApiKeyByToken(store, other.token)).not.toBeNull();
      expect(await revokeApiKey(store, identities[0]!.accountId, other.apiKey.id)).toBe(true);
      expect(await findApiKeyByToken(store, other.token)).toBeNull();

      const limiterA = new DynamoRateLimiter(db, "test", { maxRequests: 3, window: 1000 });
      const limiterB = new DynamoRateLimiter(db, "test", { maxRequests: 3, window: 1000 });
      const limits = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? limiterA : limiterB).limit("same")),
      );
      expect(limits.filter((x) => x.success)).toHaveLength(3);
      now += 1000;
      expect((await limiterA.limit("same")).success).toBe(true);

      now += 89 * 86400_000;
      await caller.drafts.upload({ html, draftId: id });
      await caller.drafts.upload({ html, draftId: id });
      await caller.drafts.upload({ html, draftId: id });
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
      expect((await caller.drafts.list()).drafts).toHaveLength(0);
      await expect(caller.drafts.upload({ html, draftId: id })).rejects.toThrow("not found");
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
      await expect(cleanupPlans(db, storage)).rejects.toThrow("Injected");
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
      config.allowAnonymousUploads = previous;
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
      await seedAccounts(store, "intent-owner");
      const context = createContextFactory({
        store,
        putHtml: async (key) => {
          if (mode === "fail") {
            throw new Error("Injected upload failure");
          }
          objects.set(key, now);
          if (mode === "late") {
            now += 301_000;
          }
        },
        getHtml: async () => "html",
      });
      const caller = createCaller(
        context(
          new Request("https://plans.example.com", {
            headers: { authorization: "Bearer intent-owner" },
          }),
          "127.0.0.1",
          false,
        ),
      );
      const html = "<!doctype html><title>Intent</title><p>Hello</p>";
      const { body: first } = await caller.drafts.upload({ html });
      mode = "fail";
      await expect(caller.drafts.upload({ html, draftId: first.draftId })).rejects.toThrow(
        "Injected",
      );
      mode = "late";
      await expect(caller.drafts.upload({ html, draftId: first.draftId })).rejects.toThrow(
        "not found",
      );
      await expect(caller.drafts.upload({ html })).rejects.toThrow("not found");
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
