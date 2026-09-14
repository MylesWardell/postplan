import { drizzle } from "drizzle-orm/d1";
import type { Query } from "drizzle-orm";
import { createDrizzleStore } from "@postplan/store-drizzle";
import * as schema from "@postplan/store-drizzle/schema";
import { limiterName } from "./rate-limit";
import { assertSqliteDatabase } from "./configuration";

export function createDatabase(binding: D1Database) {
  return Object.assign(drizzle(binding, { schema, casing: "snake_case" }), {
    async atomic(statements: Query[]) {
      if (!statements.length) {
        return;
      }
      await binding.batch(
        statements.map((query) => {
          return binding.prepare(query.sql).bind(...query.params);
        }),
      );
    },
  });
}

export function createCloudflareStore(env: Cloudflare.Env) {
  assertSqliteDatabase(env.POSTPLAN_DATABASE);
  return createDrizzleStore(createDatabase(env.POSTPLAN_DB), undefined, async (input) => {
    const name = limiterName(env.EXPERIMENT_TOKEN, input.namespace, input.key, input.rule);
    return env.RATE_LIMITS.getByName(name).limit(input.rule, input.weight);
  });
}
