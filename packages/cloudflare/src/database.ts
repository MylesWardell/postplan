import { drizzle } from "drizzle-orm/d1";
import type { Query } from "drizzle-orm";
import { createDrizzleStore } from "@postplan/store-drizzle";
import * as schema from "@postplan/store-drizzle/schema";
import { limiterName } from "./rate-limit";
import { assertSqliteDatabase } from "./configuration";
import { parseRetentionDays } from "@postplan/store/retention";
import { eq } from "drizzle-orm";

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
  const db = createDatabase(env.POSTPLAN_DB);
  // D1 prepared queries do not own local statement handles. The shared close
  // callback still evicts them from the per-database query cache.
  const connection = createDrizzleStore(db, undefined, async (input) => {
    const name = limiterName(
      env.POSTPLAN_RATE_LIMIT_SECRET,
      input.namespace,
      input.key,
      input.rule,
    );
    return env.RATE_LIMITS.getByName(name).limit(input.rule, input.weight);
  });
  return {
    ...connection,
    store: {
      accounts: connection.store.accounts,
      initialize: connection.store.initialize,
      health: connection.store.health,
      rateLimit: connection.store.rateLimit,
      drafts: {
        list: connection.store.drafts.list,
        detail: connection.store.drafts.detail,
        update: connection.store.drafts.update,
        upload: connection.store.drafts.upload,
        async findPublicVersion(
          input: Parameters<typeof connection.store.drafts.findPublicVersion>[0],
        ) {
          const result = await connection.store.drafts.findPublicVersion(input);
          if (!result.draft || !result.version) {
            return result;
          }
          const days = parseRetentionDays(process.env.PLAN_RETENTION_DAYS);
          const latest =
            input.versionNumber === undefined
              ? result.version
              : await db
                  .select()
                  .from(schema.draftVersions)
                  .where(eq(schema.draftVersions.id, result.draft.currentVersionId || ""))
                  .get();
          if (!latest || (days > 0 && latest.createdAt.getTime() <= Date.now() - days * 86400000)) {
            return { draft: null, version: null };
          }
          return result;
        },
      },
    },
  };
}
