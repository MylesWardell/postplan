import { implement } from "@orpc/server";
import { accountStoreContract } from "@postplan/store";
import type { Database } from "./database";
import * as queries from "./account-queries";

export function accountStore(db: Database) {
  const impl = implement(accountStoreContract);
  return impl.router({
    seed: impl.seed.handler(async ({ input }) => queries.seedAccounts(db, input.bootstrapKey)),
    findApiKey: impl.findApiKey.handler(async ({ input }) =>
      queries.findApiKeyByToken(db, input.token),
    ),
    createApiKey: impl.createApiKey.handler(async ({ input }) =>
      queries.createApiKey(db, input.accountId, input.name),
    ),
    revokeApiKey: impl.revokeApiKey.handler(async ({ input }) =>
      queries.revokeApiKey(db, input.accountId, input.id),
    ),
    listApiKeys: impl.listApiKeys.handler(async ({ input }) =>
      queries.listAccountApiKeys(db, input.accountId),
    ),
    findOrCreateIdentity: impl.findOrCreateIdentity.handler(async ({ input }) =>
      queries.findOrCreateAccountForIdentity(db, input),
    ),
  });
}
