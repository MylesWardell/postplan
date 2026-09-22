import assert from "node:assert/strict";

import { call } from "@orpc/server";
import { expect, test } from "vitest";

import { createContextFactory } from "#context";
import { uploadDraft } from "#routers/draft";
import type { Store, UploadContext } from "@postplan/store";
import { createTestStore } from "@postplan/store/testing";

// This same contract suite runs against either provider, without importing its driver.
async function exerciseStore(store: Store) {
  await store.health();
  await store.accounts.seed({ bootstrapKey: "contract-owner" });
  const owner = await store.accounts.findApiKey({ token: "contract-owner" });
  expect(owner?.accountId).toBe("acct_bootstrap");
  const key = await store.accounts.createApiKey({ accountId: owner!.accountId, name: "contract" });
  const keys = await store.accounts.listApiKeys({ accountId: owner!.accountId });
  expect(keys.find((item) => item.id === key.apiKey.id)?.createdAt).toBeInstanceOf(Date);
  expect(await store.accounts.revokeApiKey({ accountId: "someone-else", id: key.apiKey.id })).toBe(
    false,
  );
  expect(
    await store.accounts.revokeApiKey({ accountId: owner!.accountId, id: key.apiKey.id }),
  ).toBe(true);
  expect(await store.accounts.findApiKey({ token: key.token })).toBeNull();
  await assert.rejects(
    store.drafts.update({
      accountId: owner!.accountId,
      draftId: "missing",
      values: { title: "Updated" },
    }),
    { code: "NOT_FOUND" },
  );
  const limit = {
    namespace: "contract",
    key: "same-user",
    rule: { maxRequests: 2, window: 60_000 },
  };
  expect((await store.rateLimit(limit)).success).toBe(true);
  expect((await store.rateLimit(limit)).success).toBe(true);
  expect((await store.rateLimit(limit)).success).toBe(false);
  expect((await store.rateLimit({ ...limit, key: "another-user" })).success).toBe(true);
  await assert.rejects(store.rateLimit({ ...limit, weight: -1 }), {
    code: "BAD_REQUEST",
  });
}

test("store contract preserves dates, ownership, errors, revocation and rate-limit validation", async () => {
  const { store, close } = await createTestStore();
  try {
    await exerciseStore(store);
  } finally {
    await close();
  }
});

// CI runs this exact suite against SQLite and DynamoDB.
test("uploads require authentication before writes and preserve account ownership", async () => {
  const { store, close } = await createTestStore();
  const objects = new Map<string, string>();
  const html = "<!doctype html><title>Authenticated</title><p>Draft</p>";
  const context: UploadContext = {
    apiKey: null,
    requestBaseUrl: "https://plans.example.com",
    sourceIp: null,
    userAgent: null,
    requestId: null,
    maxHtmlBytes: 512 * 1024,
    putHtml: async (key, value) => {
      objects.set(key, value);
    },
  };
  try {
    await store.accounts.seed({ bootstrapKey: "upload-owner" });
    const owner = await store.accounts.findApiKey({ token: "upload-owner" });
    assert.ok(owner);
    for (const token of ["invalid", "postplan-public-upload-sentinel"]) {
      assert.equal(await store.accounts.findApiKey({ token }), null);
    }
    const legacy = { ...owner, id: "key_public_upload", accountId: "acct_public_upload" };
    for (const apiKey of [null, legacy, { ...owner, accountId: legacy.accountId }]) {
      for (const input of [{ html }, { html, draftId: "legacy-draft" }, { html: "<form>" }]) {
        await assert.rejects(store.drafts.upload({ context: { ...context, apiKey }, input }), {
          code: "UNAUTHORIZED",
        });
      }
    }
    assert.equal(objects.size, 0);
    assert.equal((await store.drafts.totals({ accountId: legacy.accountId })).drafts, 0);
    context.apiKey = owner;
    const first = await store.drafts.upload({ context, input: { html } });
    assert.ok(first.ok);
    assert.equal(first.versionNumber, 1);
    const input = { html, draftId: first.draftId };
    await assert.rejects(store.drafts.upload({ context: { ...context, apiKey: null }, input }), {
      code: "UNAUTHORIZED",
    });
    const otherAccount = await store.accounts.findOrCreateIdentity({
      provider: "test",
      subject: "upload-other",
    });
    const otherKey = await store.accounts.createApiKey({
      accountId: otherAccount.accountId,
      name: "other",
    });
    await assert.rejects(
      store.drafts.upload({
        context: { ...context, apiKey: await store.accounts.findApiKey({ token: otherKey.token }) },
        input,
      }),
      { code: "NOT_FOUND" },
    );
    assert.equal(objects.size, 1);
    assert.equal(
      (await store.drafts.detail({ accountId: owner.accountId, draftId: first.draftId, context }))
        ?.versions.length,
      1,
    );
    const updated = await store.drafts.upload({ context, input });
    assert.ok(updated.ok);
    assert.equal(updated.versionNumber, 2);
    assert.equal(objects.size, 2);
  } finally {
    await close();
  }
});

test("in-process upload procedure requires a valid bearer key", async () => {
  const { store, close } = await createTestStore();
  let writes = 0;
  try {
    await store.accounts.seed({ bootstrapKey: "procedure-owner" });
    const createContext = createContextFactory({
      store,
      putHtml: async () => {
        writes++;
      },
      getHtml: async () => "",
    });
    const input = { html: "<!doctype html><title>Procedure</title><p>Draft</p>" };
    const invoke = (token?: string) =>
      call(uploadDraft, input, {
        context: createContext(
          new Request("https://plans.example.com/api/uploads", {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          }),
          null,
          false,
        ),
      });
    for (const token of [undefined, "invalid", "postplan-public-upload-sentinel"]) {
      await assert.rejects(invoke(token), { code: "UNAUTHORIZED" });
    }
    assert.equal(writes, 0);
    assert.equal((await invoke("procedure-owner")).status, 201);
    assert.equal(writes, 1);
  } finally {
    await close();
  }
});
