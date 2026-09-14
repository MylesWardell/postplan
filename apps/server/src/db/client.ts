import { Database as SQLite } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { createDynamoDatabase } from "./dynamo";
import type { DynamoDatabase } from "./dynamo";

export function createDatabase(filename = process.env.DATABASE_PATH || "data/postplan.sqlite") {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const client = new SQLite(filename, { create: true });
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return { db: drizzle(client, { schema, casing: "snake_case" }), client };
}
export type Database = ReturnType<typeof createDatabase>["db"] | DynamoDatabase;

export function createRuntimeDatabase() {
  const names = [
    "POSTPLAN_IDENTITY_TABLE",
    "POSTPLAN_PLANS_TABLE",
    "POSTPLAN_RECORDS_TABLE",
    "POSTPLAN_RATE_LIMITS_TABLE",
  ] as const;
  const values = names.map((name) => process.env[name]);
  if (values.some(Boolean) || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    for (const name of names) {
      if (!process.env[name]?.trim()) {
        throw new Error(`Missing ${name}`);
      }
    }
    const db = createDynamoDatabase({
      identity: values[0]!,
      plans: values[1]!,
      records: values[2]!,
      limits: values[3]!,
    });
    return { db, close: () => db.client.destroy() };
  }
  const { db, client } = createDatabase();
  return { db, close: () => client.close() };
}
