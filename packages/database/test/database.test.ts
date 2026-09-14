import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/schema.js";
import {
  createApiKey,
  findApiKeyByToken,
  findOrCreateAccountForIdentity,
  revokeApiKey,
  seedAccounts,
} from "../src/accounts.js";

test("migrations, bootstrap keys, revocation and identity updates use PostgreSQL semantics", async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
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

test("the compatibility baseline preserves an existing installation", async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    const directory = new URL("../../drizzle/", import.meta.url);
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8")) as {
      entries: { tag: string }[];
    };
    const tag = journal.entries[0]?.tag;
    assert.ok(tag);
    // Simulate the old startup-created schema without a Drizzle journal.
    await client.exec(readFileSync(new URL(`${tag}.sql`, directory), "utf8"));
    await db.insert(schema.accounts).values({ id: "existing", name: "Keep me" });
    await migrate(db, { migrationsFolder: fileURLToPath(directory) });
    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, "existing"));
    assert.equal(account?.name, "Keep me");
  } finally {
    await client.close();
  }
});
