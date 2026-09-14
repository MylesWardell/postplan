import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

const { pool } = createDatabase({
  databaseUrl: process.env.DATABASE_URL,
  databaseSslCaFile: process.env.DATABASE_SSL_CA_FILE,
});
try {
  const client = await pool.connect();
  try {
    // Use one connection for the lock and migration; concurrent jobs serialize.
    await client.query("SELECT pg_advisory_lock($1)", [7_406_311_021]);
    try {
      await migrate(drizzle(client), {
        migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)),
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [7_406_311_021]);
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
