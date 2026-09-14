import assert from "node:assert/strict";
import { expect, test } from "bun:test";
import type { Store } from "@postplan/store";
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
