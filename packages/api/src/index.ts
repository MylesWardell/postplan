import { oc } from "@orpc/contract";
import type { RouterContractClient } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import * as schemas from "./schemas/index";
export * from "./schemas/index";

const publicContract = oc.errors({
  BAD_REQUEST: {},
  TOO_MANY_REQUESTS: {},
  INTERNAL_SERVER_ERROR: {},
});
const protectedContract = publicContract
  .errors({ UNAUTHORIZED: {}, FORBIDDEN: {}, NOT_FOUND: {} })
  .meta(openapi({ spec: (current) => ({ ...current, security: [{ bearerAuth: [] }] }) }));
export const contract = {
  account: {
    me: protectedContract
      .meta(openapi({ method: "GET", path: "/me", tags: ["Account"] }))
      .output(schemas.account),
  },
  drafts: {
    list: protectedContract
      .meta(openapi({ method: "GET", path: "/drafts", tags: ["Drafts"] }))
      .input(schemas.listDraftsInput)
      .output(schemas.draftList),
    totals: protectedContract
      .meta(openapi({ method: "GET", path: "/drafts/totals", tags: ["Drafts"] }))
      .output(schemas.draftTotals),
    detail: protectedContract
      .meta(openapi({ method: "GET", path: "/drafts/{draftId}", tags: ["Drafts"] }))
      .input(schemas.draftId)
      .output(schemas.draftDetail),
    update: protectedContract
      .meta(openapi({ method: "PATCH", path: "/drafts/{draftId}", tags: ["Drafts"] }))
      .input(schemas.updateDraftInput)
      .output(schemas.ok),
    delete: protectedContract
      .meta(openapi({ method: "DELETE", path: "/drafts/{draftId}", tags: ["Drafts"] }))
      .input(schemas.draftId)
      .output(schemas.ok),
    disable: protectedContract
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/disable", tags: ["Drafts"] }))
      .input(schemas.disableDraftInput)
      .output(schemas.ok),
    enable: protectedContract
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/enable", tags: ["Drafts"] }))
      .input(schemas.draftId)
      .output(schemas.ok),
    upload: publicContract
      .meta(
        openapi({
          method: "POST",
          path: "/uploads",
          tags: ["Drafts"],
          outputStructure: "detailed",
        }),
      )
      .errors({ UNPROCESSABLE_CONTENT: { data: schemas.uploadRejected } })
      .input(schemas.uploadInput)
      .output(schemas.uploadOutput),
  },
  apiKeys: {
    list: protectedContract
      .meta(openapi({ method: "GET", path: "/api-keys", tags: ["API keys"] }))
      .output(schemas.apiKeyList),
    create: protectedContract
      .meta(openapi({ method: "POST", path: "/api-keys", tags: ["API keys"], successStatus: 201 }))
      .input(schemas.createApiKeyInput)
      .output(schemas.createdApiKey),
    revoke: protectedContract
      .meta(openapi({ method: "POST", path: "/api-keys/{apiKeyId}/revoke", tags: ["API keys"] }))
      .input(schemas.revokeApiKeyInput)
      .output(schemas.ok),
  },
};
export type ApiClient = RouterContractClient<typeof contract>;
