import { createDrizzleStore, createDatabase } from "@postplan/store-drizzle";
import { createDynamoStore, createDynamoDatabase } from "@postplan/store-dynamodb";
import type { StoreConnection } from "@postplan/store";
import { config } from "#config";

// Backend selection belongs only at the application composition boundary.
export function createRuntimeStore(): StoreConnection {
  const names = [
    "POSTPLAN_IDENTITY_TABLE",
    "POSTPLAN_PLANS_TABLE",
    "POSTPLAN_RECORDS_TABLE",
    "POSTPLAN_RATE_LIMITS_TABLE",
  ] as const;
  const values = names.map((name) => process.env[name]);
  if (values.some(Boolean) || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const db = createRuntimeDynamoDatabase();
    return createDynamoStore(db, () => db.client.destroy());
  }
  const { db, client } = createDatabase(config.databasePath);
  return createDrizzleStore(db, () => client.close());
}

function createRuntimeDynamoDatabase() {
  const names = [
    "POSTPLAN_IDENTITY_TABLE",
    "POSTPLAN_PLANS_TABLE",
    "POSTPLAN_RECORDS_TABLE",
    "POSTPLAN_RATE_LIMITS_TABLE",
  ] as const;
  const values = names.map((name) => process.env[name]);
  for (const name of names) {
    if (!process.env[name]?.trim()) {
      throw new Error(`Missing ${name}`);
    }
  }
  const db = createDynamoDatabase(
    { identity: values[0]!, plans: values[1]!, records: values[2]!, limits: values[3]! },
    {
      endpoint: process.env.POSTPLAN_DYNAMODB_ENDPOINT,
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-2",
      retentionDays: () => config.planRetentionDays,
    },
  );
  return db;
}
