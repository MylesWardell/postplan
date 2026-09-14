import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase } from "./client.js";

const { db, client } = createDatabase();
try {
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)) });
} finally {
  client.close();
}
