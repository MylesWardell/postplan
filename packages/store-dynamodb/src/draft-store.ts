import { implement } from "@orpc/server";

import { draftStoreContract } from "@postplan/store";

import type { DynamoDatabase } from "./dynamo";
import * as queries from "./dynamo-drafts";

export function draftStore(db: DynamoDatabase) {
  const impl = implement(draftStoreContract);
  return impl.router({
    list: impl.list.handler(async ({ input }) => queries.listDynamoDrafts(db, input)),
    totals: impl.totals.handler(async ({ input }) =>
      queries.getDynamoDraftTotals(db, input.accountId),
    ),
    detail: impl.detail.handler(async ({ input }) =>
      queries.getDynamoDraft(db, input.accountId, input.draftId, input.context),
    ),
    findPublicVersion: impl.findPublicVersion.handler(async ({ input }) =>
      queries.findDynamoPublicVersion(db, input.draftId, input.versionNumber),
    ),
    update: impl.update.handler(async ({ input }) =>
      queries.updateDynamoDraft(db, input.accountId, input.draftId, input.values),
    ),
    upload: impl.upload.handler(async ({ input }) =>
      queries.uploadDynamoDraft(db, input.context, input.input),
    ),
  });
}
