import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  createDatabase,
  findApiKeyByToken,
  findOrCreateAccountForIdentity,
  seedAccounts,
} from "@postplan/database";
import { createCaller } from "../src/client.js";

(process.env.TEST_DATABASE_URL ? test : test.skip)(
  "separate PostgreSQL connections serialize draft versions and concurrent first logins",
  async () => {
    const { db, pool } = createDatabase({
      databaseUrl: process.env.TEST_DATABASE_URL,
      databaseSslCaFile: undefined,
    });
    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL("../../../packages/database/drizzle", import.meta.url),
        ),
      });
      await seedAccounts(db, "concurrency-key");
      const caller = createCaller({
        db,
        apiKey: await findApiKeyByToken(db, "concurrency-key"),
        session: null,
        requestBaseUrl: "https://plans.example.com",
        publicBaseUrl: undefined,
        sourceIp: null,
        userAgent: null,
        requestId: null,
        maxHtmlBytes: 524288,
        putHtml: async () => {},
        limit: () => {},
      });
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
      await pool.end();
    }
  },
);
