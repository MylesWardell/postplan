import { Database as SQLite, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import type { Query } from "drizzle-orm";

export function createDatabase(filename = process.env.DATABASE_PATH || "data/postplan.sqlite") {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const client = new SQLite(filename, { create: true });
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const db = drizzle(client, { schema, casing: "snake_case" });
  return {
    db: Object.assign(db, {
      async atomic(statements: Query[]) {
        client
          .transaction(() => {
            for (const statement of statements) {
              client.query(statement.sql).run(...(statement.params as SQLQueryBindings[]));
            }
          })
          .immediate();
      },
    }),
    client,
  };
}
export type Database = ReturnType<typeof createDatabase>["db"];
