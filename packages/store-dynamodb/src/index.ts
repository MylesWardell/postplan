import { createRouterClient, implement } from "@orpc/server";

import { storeContract } from "@postplan/store";
import type { StoreConnection } from "@postplan/store";

import { accountStore } from "./account-store";
import { draftStore } from "./draft-store";
import type { DynamoDatabase } from "./dynamo";
import { DynamoRateLimiter } from "./dynamo-rate-limit";

export { createDynamoDatabase } from "./dynamo";

export function createDynamoStore(
  db: DynamoDatabase,
  close: () => void = () => {},
): StoreConnection {
  const impl = implement(storeContract);
  const router = impl.router({
    accounts: accountStore(db),
    drafts: draftStore(db),
    initialize: impl.initialize.handler(async () => db.health()),
    health: impl.health.handler(async () => db.health()),
    rateLimit: impl.rateLimit.handler(async ({ input }) => {
      const limiter = new DynamoRateLimiter(db, input.namespace, input.rule);
      return limiter.limit(input.key, { weight: input.weight });
    }),
  });
  return { store: createRouterClient(router), close };
}
