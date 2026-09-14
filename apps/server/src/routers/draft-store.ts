import type { Store, UrlContext, DraftUpdates, UploadInput } from "@postplan/store";
import type { ApiContext } from "#context";
export type { AccountDraft, AccountDraftDetail, UploadInput } from "@postplan/store";
export { cleanText } from "@postplan/store";
export const listAccountDrafts = (store: Store, accountId: string, context: UrlContext) =>
  store.drafts.list({ accountId, context });
export const getAccountDraftWithVersions = (
  store: Store,
  accountId: string,
  draftId: string,
  context: UrlContext,
) => store.drafts.detail({ accountId, draftId, context });
export const findPublicDraftVersion = (store: Store, draftId: string, versionNumber?: number) =>
  store.drafts.findPublicVersion({ draftId, versionNumber });
export const updateOwnedDraft = (
  store: Store,
  accountId: string,
  draftId: string,
  values: DraftUpdates,
) => store.drafts.update({ accountId, draftId, values });
export const uploadDraft = (context: ApiContext, input: UploadInput) =>
  context.store.drafts.upload({ context, input });
