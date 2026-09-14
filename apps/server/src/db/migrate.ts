import { createDatabase } from "@postplan/store-drizzle";
import { migrateDatabase } from "@postplan/store-drizzle/migrate";
const { db, client } = createDatabase();
try {
  migrateDatabase(db);
} finally {
  client.close();
}
