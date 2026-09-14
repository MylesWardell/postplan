import { publicOS } from "#orpc";
import { getAccount } from "./account";
import {
  listDrafts,
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
    detail: getDraft,
    update: updateDraft,
    delete: deleteDraft,
    disable: disableDraft,
    enable: enableDraft,
    upload: uploadDraft,
  },
  apiKeys: { list: listApiKeys, create: createApiKey, revoke: revokeApiKey },
});
