import type { StoreConnection } from "@postplan/store";
import { createDrizzleStore } from "@postplan/store-drizzle";
import { createDatabase } from "@postplan/store-drizzle/client";
import { createDynamoStore } from "@postplan/store-dynamodb";

import { selectDatabase } from "./configuration";
import { createRuntimeDynamoDatabase } from "./database";

// Backend selection belongs only at the application composition boundary.
export function createRuntimeStore(config: {
  databasePath: string;
  planRetentionDays: number;
}): StoreConnection {
  if (selectDatabase() === "dynamodb") {
    const db = createRuntimeDynamoDatabase(() => config.planRetentionDays);
    return createDynamoStore(db, () => db.client.destroy());
  }
  const { db, client } = createDatabase(config.databasePath);
  return createDrizzleStore(db, () => client.close());
}
