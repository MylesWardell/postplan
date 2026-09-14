import { createDatabase } from "../../src/db/client.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.js";
import {
  createApiKey,
  findApiKeyByToken,
  findOrCreateAccountForIdentity,
  revokeApiKey,
  seedAccounts,
} from "../../src/routers/account-store.js";

test("SQLite survives reopen and rolls back a failed transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "postplan-sqlite-"));
  const filename = join(directory, "postplan.sqlite");
  let connection = createDatabase(filename);
  try {
    migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    await seedAccounts(connection.db, "persistent-key");
    assert.throws(() =>
      connection.db.transaction((tx) => {
        tx.insert(schema.accounts).values({ id: "rolled-back", name: "Rollback" }).run();
        tx.insert(schema.apiKeys)
          .values({
            id: "invalid",
            name: "Invalid",
            account_id: "missing",
            key_hash: "hash",
          })
          .run();
      }),
    );
    connection.client.close();
    connection = createDatabase(filename);
    assert.equal(
      (await findApiKeyByToken(connection.db, "persistent-key"))?.account_id,
      "acct_bootstrap",
    );
    assert.equal(
      connection.db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, "rolled-back"))
        .all().length,
      0,
    );
    assert.ok(connection.db.select().from(schema.accounts).get()?.created_at instanceof Date);
    assert.deepEqual(connection.client.query("PRAGMA integrity_check").get(), {
      integrity_check: "ok",
    });
    assert.deepEqual(connection.client.query("PRAGMA foreign_key_check").all(), []);
  } finally {
    connection.client.close();
    // Release Drizzle's temporary prepared statements before deleting the file on Windows.
    Bun.gc(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrations, bootstrap keys, revocation and identity updates use SQLite semantics", async () => {
  const { db, client } = createDatabase(":memory:");
  try {
    const options = { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) };
    await migrate(db, options);
    await migrate(db, options);
    await seedAccounts(db, "bootstrap-test");
    await seedAccounts(db, "bootstrap-test");
    assert.equal((await findApiKeyByToken(db, "bootstrap-test"))?.account_id, "acct_bootstrap");
    assert.equal(await findApiKeyByToken(db, "postplan-public-upload-sentinel"), null);
    const key = await createApiKey(db, "acct_bootstrap", "test");
    assert.equal(await revokeApiKey(db, "someone-else", key.apiKey.id), false);
    assert.ok(await findApiKeyByToken(db, key.token));
    assert.equal(await revokeApiKey(db, "acct_bootstrap", key.apiKey.id), true);
    assert.equal(await findApiKeyByToken(db, key.token), null);
    const first = await findOrCreateAccountForIdentity(db, {
      provider: "test",
      subject: "user",
      profile: { email: "test@example.com", piiSubject: "stable" },
    });
    const second = await findOrCreateAccountForIdentity(db, { provider: "test", subject: "user" });
    assert.equal(first.accountId, second.accountId);
    assert.equal(second.email, null);
    const [identity] = await db
      .select()
      .from(schema.identities)
      .where(eq(schema.identities.account_id, first.accountId));
    assert.equal(identity?.pii_subject, "stable");
  } finally {
    await client.close();
  }
});
