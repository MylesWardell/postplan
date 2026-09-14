import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { databasePoolConfig } from "./config.js";
import type { DatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDatabase(config: DatabaseConfig) {
  const pool = new pg.Pool(databasePoolConfig(config));
  const db = drizzle(pool, { schema });
  return { db, pool };
}
