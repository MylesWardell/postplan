import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { SQL, Query } from "drizzle-orm";
import type * as schema from "./schema";

// Drivers execute these statements serially in one transaction, rolling back on error.
// No callback transactions: asynchronous SQLite hosts may only support atomic batches.
export type Database = Pick<
  BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>,
  "select" | "insert" | "update" | "delete" | "get"
> & { atomic(statements: Query[]): Promise<void> };

import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
const dialect = new SQLiteSyncDialect({ casing: "snake_case" });
export function statement(query: SQL | { toSQL(): Query }): Query {
  return "toSQL" in query ? query.toSQL() : dialect.sqlToQuery(query);
}

// Building SQL from Drizzle's query builders costs more CPU than most requests'
// remaining work, so hot queries are built once per database with placeholders.
type Finalizable = { stmt?: { finalize?: () => void } };
const preparedByDatabase = new WeakMap<Database, Map<object, Finalizable>>();
export function prepared<T>(build: (db: Database) => T): (db: Database) => T {
  const key = {};
  return (db) => {
    let queries = preparedByDatabase.get(db);
    if (!queries) {
      queries = new Map();
      preparedByDatabase.set(db, queries);
    }
    let query = queries.get(key) as T | undefined;
    if (query === undefined) {
      query = build(db);
      queries.set(key, query as Finalizable);
    }
    return query;
  };
}

// Bun SQLite keeps the database file open until its statements are finalized.
export function finalizePrepared(db: Database) {
  for (const query of preparedByDatabase.get(db)?.values() ?? []) {
    query.stmt?.finalize?.();
  }
  preparedByDatabase.delete(db);
}
