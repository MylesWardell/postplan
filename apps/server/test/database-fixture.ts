import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase } from "#db/client";
import { accounts } from "#db/schema";
import { dynamoEndpoint, dynamoFixture } from "./dynamo-fixture";

export async function testDatabase() {
  if (dynamoEndpoint) {
    const fixture = await dynamoFixture();
    return {
      ...fixture,
      async createAccount(id: string, name: string) {
        await fixture.db.put(fixture.db.tables.identity, {
          pk: `ACCOUNT#${id}`,
          sk: "META",
          id,
          name,
          createdAt: Date.now(),
        });
      },
    };
  }
  const { db, client } = createDatabase(":memory:");
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return {
    db,
    close: async () => {
      client.close();
    },
    async createAccount(id: string, name: string) {
      await db.insert(accounts).values({ id, name });
    },
  };
}
