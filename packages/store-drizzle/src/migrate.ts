import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase } from "./client";
import type { Database } from "./client";
export function migrateDatabase(db: Database) {
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}
if (import.meta.main) {
  const { db, client } = createDatabase();
  try {
    migrateDatabase(db);
  } finally {
    client.close();
  }
}
