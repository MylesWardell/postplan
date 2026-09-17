import { publicOS } from "#orpc";
import { getAccount } from "./account";
import {
  listDrafts,
  listDraftTotals,
  getDraft,
  updateDraft,
  deleteDraft,
  disableDraft,
  enableDraft,
  uploadDraft,
} from "./draft";
import { listApiKeys, createApiKey, revokeApiKey } from "./api-key";

export const router = publicOS.router({
  account: { me: getAccount },
  drafts: {
    list: listDrafts,
    totals: listDraftTotals,
    detail: getDraft,
    update: updateDraft,
    delete: deleteDraft,
    disable: disableDraft,
    enable: enableDraft,
    upload: uploadDraft,
  },
  apiKeys: { list: listApiKeys, create: createApiKey, revoke: revokeApiKey },
});
