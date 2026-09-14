import { migrateDatabase } from "@postplan/store-drizzle/migrate";
import { createDatabase, createDrizzleStore } from "@postplan/store-drizzle";
import { accounts } from "@postplan/store-drizzle/schema";
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
  migrateDatabase(db);
  return {
    store: createDrizzleStore(db).store,
    close: async () => {
      client.close();
    },
    async createAccount(id: string, name: string) {
      await db.insert(accounts).values({ id, name });
    },
  };
}
