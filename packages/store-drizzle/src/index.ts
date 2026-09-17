import { createRouterClient, implement } from "@orpc/server";
import { storeContract } from "@postplan/store";
import type { Store, StoreConnection } from "@postplan/store";
import type { Database } from "./database";
import { accountStore } from "./account-store";
import { draftStore } from "./draft-store";
import { sql } from "drizzle-orm";
import { MemoryRateLimiter } from "@orpc/ratelimit/memory";
import { seedAccounts } from "./account-queries";
import { finalizePrepared } from "./database";
export type { Database } from "./database";

export function createDrizzleStore(
  db: Database,
  close: () => void = () => {},
  rateLimit?: Store["rateLimit"],
): StoreConnection {
  const impl = implement(storeContract);
  const limits = new Map<string, MemoryRateLimiter>();
  const router = impl.router({
    accounts: accountStore(db),
    drafts: draftStore(db),
    initialize: impl.initialize.handler(async ({ input }) => {
      await db.get(sql`select 1`);
      await seedAccounts(db, input.bootstrapKey);
    }),
    health: impl.health.handler(async () => {
      await db.get(sql`select 1`);
    }),
    rateLimit: impl.rateLimit.handler(async ({ input }) => {
      if (rateLimit) {
        return rateLimit(input);
      }
      const key = JSON.stringify([input.namespace, input.rule.window, input.rule.maxRequests]);
      let limiter = limits.get(key);
      if (!limiter) {
        limiter = new MemoryRateLimiter(input.rule);
        limits.set(key, limiter);
      }
      return limiter.limit(input.key, { weight: input.weight });
    }),
  });
  let closed = false;
  return {
    store: createRouterClient(router),
    close() {
      if (closed) {
        return;
      }
      finalizePrepared(db);
      close();
      closed = true;
    },
  };
}
