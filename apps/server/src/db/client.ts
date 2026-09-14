import { Database as SQLite } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export function createDatabase(filename = process.env.DATABASE_PATH || "data/postplan.sqlite") {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const client = new SQLite(filename, { create: true });
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return { db: drizzle(client, { schema }), client };
}
export type Database = ReturnType<typeof createDatabase>["db"];
