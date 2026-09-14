import { createContextFactory } from "../src/http/context.js";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase } from "../src/db/client.js";
import { findOrCreateAccountForIdentity, seedAccounts } from "../src/routers/account-store.js";
import { createCaller } from "../src/client.js";

test("concurrent requests serialize SQLite draft versions and first logins", async () => {
  const { db, client } = createDatabase(":memory:");
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedAccounts(db, "concurrency-key");
    const context = createContextFactory({ db, putHtml: async () => {}, getHtml: async () => "" });
    const caller = createCaller(
      await context(
        new Request("https://plans.example.com", {
          headers: { authorization: "Bearer concurrency-key" },
        }),
      ),
    );
    const html = "<!doctype html><title>Concurrent</title><p>Versions</p>";
    const { body: first } = await caller.drafts.upload({ html });
    assert.ok(first.ok);
    if (!first.ok) throw new Error("Upload failed");
    const versions = await Promise.all(
      Array.from({ length: 6 }, () => caller.drafts.upload({ html, draftId: first.draftId })),
    );
    assert.deepEqual(
      versions.map((version) => version.body.versionNumber).sort((a, b) => a - b),
      [2, 3, 4, 5, 6, 7],
    );
    assert.equal(
      (await caller.drafts.detail({ draftId: first.draftId })).versions[0]?.version_number,
      7,
    );
    assert.equal(
      (await caller.drafts.list()).drafts.find((draft) => draft.draftId === first.draftId)
        ?.latestVersionNumber,
      7,
    );
    const identities = await Promise.all(
      Array.from({ length: 4 }, () =>
        findOrCreateAccountForIdentity(db, { provider: "test", subject: "concurrent-user" }),
      ),
    );
    assert.equal(new Set(identities.map((identity) => identity.accountId)).size, 1);
  } finally {
    client.close();
  }
});
