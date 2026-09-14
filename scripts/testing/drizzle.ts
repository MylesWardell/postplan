import { registerTestStore } from "@postplan/store/testing";
import { createDrizzleStore } from "@postplan/store-drizzle";
import { createDatabase } from "@postplan/store-drizzle/client";
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
