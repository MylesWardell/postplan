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
