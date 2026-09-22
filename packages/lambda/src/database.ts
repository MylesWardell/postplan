import { createDynamoDatabase } from "@postplan/store-dynamodb";
export function createRuntimeDynamoDatabase(retentionDays: () => number) {
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
      retentionDays,
    },
  );
  return db;
}
