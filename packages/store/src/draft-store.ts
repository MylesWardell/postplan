import { oc, type } from "@orpc/contract";
import { z } from "zod";
import {
  accountDraft,
  draftDetail,
  draftStatus,
  draftTotals,
  ok,
  uploadSuccess,
  uploadRejected,
} from "@postplan/api";
import { draft, draftVersion, draftUpdates, urlContext } from "./models";
import type { UploadContext, UploadInput } from "./models";

const owned = z.object({ accountId: z.string(), draftId: z.string() });
export const draftStoreContract = {
  // Keyset page ordered by (updatedAt, draftId) descending. `after` is the last row of the
  // previous page; stores return at most `limit` rows and whether another page exists.
  list: oc
    .input(
      z.object({
        accountId: z.string(),
        context: urlContext,
        limit: z.number().int().positive(),
        after: z.object({ updatedAt: z.date(), draftId: z.string() }).optional(),
        q: z.string().optional(),
        status: draftStatus,
      }),
    )
    .output(z.object({ drafts: z.array(accountDraft), hasMore: z.boolean() })),
  totals: oc.input(z.object({ accountId: z.string() })).output(draftTotals),
  detail: oc.input(owned.extend({ context: urlContext })).output(draftDetail.nullable()),
  findPublicVersion: oc
    .input(z.object({ draftId: z.string(), versionNumber: z.number().optional() }))
    .output(z.object({ draft: draft.nullable(), version: draftVersion.nullable() })),
  update: oc
    .errors({ NOT_FOUND: {} })
    .input(owned.extend({ values: draftUpdates }))
    .output(ok),
  // In-process contract: the storage callback is supplied by the application, never over HTTP.
  upload: oc
    .errors({ NOT_FOUND: {}, BAD_REQUEST: {} })
    .input(type<{ context: UploadContext; input: UploadInput }>())
    .output(z.discriminatedUnion("ok", [uploadSuccess, uploadRejected])),
};
