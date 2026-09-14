import { createDrizzleStore } from "@postplan/store-drizzle";
import { createDatabase } from "@postplan/store-drizzle/client";
import { createDynamoStore } from "@postplan/store-dynamodb";
import type { StoreConnection } from "@postplan/store";
import { createRuntimeDynamoDatabase } from "./database";

// Backend selection belongs only at the application composition boundary.
export function createRuntimeStore(config: {
  databasePath: string;
  planRetentionDays: number;
}): StoreConnection {
  const names = [
    "POSTPLAN_IDENTITY_TABLE",
    "POSTPLAN_PLANS_TABLE",
    "POSTPLAN_RECORDS_TABLE",
    "POSTPLAN_RATE_LIMITS_TABLE",
  ] as const;
  const values = names.map((name) => process.env[name]);
  if (values.some(Boolean) || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const db = createRuntimeDynamoDatabase(() => config.planRetentionDays);
    return createDynamoStore(db, () => db.client.destroy());
  }
  const { db, client } = createDatabase(config.databasePath);
  return createDrizzleStore(db, () => client.close());
}
