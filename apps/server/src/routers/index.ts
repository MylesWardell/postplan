import { publicOS } from "../orpc.js";
import { getAccount } from "./account.js";
import {
  listDrafts,
  getDraft,
  updateDraft,
  deleteDraft,
  disableDraft,
  enableDraft,
  uploadDraft,
} from "./draft.js";
import { listApiKeys, createApiKey, revokeApiKey } from "./api-key.js";

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
