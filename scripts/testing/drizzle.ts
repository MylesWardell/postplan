import { registerTestStore } from "@postplan/store/testing";
import { createDatabase, createDrizzleStore } from "@postplan/store-drizzle";
import { migrateDatabase } from "@postplan/store-drizzle/migrate";
registerTestStore(async () => {
  const { db, client } = createDatabase(":memory:");
  try {
    migrateDatabase(db);
    return createDrizzleStore(db, () => client.close());
  } catch (error) {
    client.close();
    throw error;
  }
});
