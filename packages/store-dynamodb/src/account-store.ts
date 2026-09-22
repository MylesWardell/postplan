import { implement } from "@orpc/server";

import { accountStoreContract } from "@postplan/store";

import type { DynamoDatabase } from "./dynamo";
import * as queries from "./dynamo-accounts";

export function accountStore(db: DynamoDatabase) {
  const impl = implement(accountStoreContract);
  return impl.router({
    seed: impl.seed.handler(async ({ input }) =>
      queries.seedDynamoAccounts(db, input.bootstrapKey),
    ),
    findApiKey: impl.findApiKey.handler(async ({ input }) =>
      queries.findDynamoApiKey(db, input.token),
    ),
    createApiKey: impl.createApiKey.handler(async ({ input }) =>
      queries.createDynamoApiKey(db, input.accountId, input.name),
    ),
    revokeApiKey: impl.revokeApiKey.handler(async ({ input }) =>
      queries.revokeDynamoApiKey(db, input.accountId, input.id),
    ),
    listApiKeys: impl.listApiKeys.handler(async ({ input }) =>
      queries.listDynamoApiKeys(db, input.accountId),
    ),
    findOrCreateIdentity: impl.findOrCreateIdentity.handler(async ({ input }) =>
      queries.findDynamoIdentity(db, input),
    ),
  });
}
