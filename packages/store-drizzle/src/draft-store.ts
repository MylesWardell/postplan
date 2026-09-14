import { implement } from "@orpc/server";
import { draftStoreContract } from "@postplan/store";
import type { Database } from "./client";
import * as queries from "./draft-queries";

export function draftStore(db: Database) {
  const impl = implement(draftStoreContract);
  return impl.router({
    list: impl.list.handler(async ({ input }) =>
      queries.listAccountDrafts(db, input.accountId, input.context),
    ),
    detail: impl.detail.handler(async ({ input }) =>
      queries.getAccountDraftWithVersions(db, input.accountId, input.draftId, input.context),
    ),
    findPublicVersion: impl.findPublicVersion.handler(async ({ input }) =>
      queries.findPublicDraftVersion(db, input.draftId, input.versionNumber),
    ),
    update: impl.update.handler(async ({ input }) =>
      queries.updateOwnedDraft(db, input.accountId, input.draftId, input.values),
    ),
    upload: impl.upload.handler(async ({ input }) =>
      queries.uploadDraft(db, input.context, input.input),
    ),
  });
}
