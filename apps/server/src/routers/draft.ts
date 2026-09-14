import { ORPCError } from "@orpc/server";
import { publicUploadAuth } from "@postplan/database";
import { publicOS, protectedOS } from "../orpc.js";
import {
  cleanText,
  getAccountDraftWithVersions,
  listAccountDrafts,
  updateOwnedDraft,
  uploadDraft as persistUpload,
} from "../services/drafts.js";

export const listDrafts = protectedOS.drafts.list.handler(async ({ context: ctx }) => ({
  ok: true,
  drafts: await listAccountDrafts(ctx.db, ctx.account.accountId, ctx),
}));
export const getDraft = protectedOS.drafts.detail.handler(async ({ context: ctx, input }) => {
  const result = await getAccountDraftWithVersions(
    ctx.db,
    ctx.account.accountId,
    input.draftId,
    ctx,
  );
  if (!result) throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  return result;
});
export const updateDraft = protectedOS.drafts.update.handler(
  ({ context: ctx, input: { draftId, ...values } }) =>
    updateOwnedDraft(ctx.db, ctx.account.accountId, draftId, values),
);
export const deleteDraft = protectedOS.drafts.delete.handler(({ context: ctx, input }) =>
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, { deleted_at: new Date() }),
);
export const disableDraft = protectedOS.drafts.disable.handler(({ context: ctx, input }) =>
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
    disabled_at: new Date(),
    disabled_reason: cleanText(input.reason) || "Disabled by owner.",
  }),
);
export const enableDraft = protectedOS.drafts.enable.handler(({ context: ctx, input }) =>
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
    disabled_at: null,
    disabled_reason: null,
  }),
);
export const uploadDraft = publicOS.drafts.upload.handler(async ({ context: ctx, input }) => {
  ctx.limit("upload-ip", ctx.sourceIp || "anonymous");
  ctx.limit("upload-key", ctx.apiKey?.id ?? publicUploadAuth.id);
  if (ctx.session && !ctx.apiKey)
    throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
  const result = await persistUpload(ctx, input);
  if (!result.ok)
    throw new ORPCError("UNPROCESSABLE_CONTENT", {
      message: "HTML validation failed.",
      data: result,
    });
  return { status: result.versionNumber === 1 ? (201 as const) : (200 as const), body: result };
});
