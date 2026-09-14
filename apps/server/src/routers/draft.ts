import { ratelimit } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";
import { publicUploadAuth } from "./account-store.js";
import { publicOS, protectedOS } from "#orpc";
import {
  cleanText,
  getAccountDraftWithVersions,
  listAccountDrafts,
  updateOwnedDraft,
  uploadDraft as persistUpload,
} from "#routers/draft-store";

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
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, { deletedAt: new Date() }),
);
export const disableDraft = protectedOS.drafts.disable.handler(({ context: ctx, input }) =>
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
    disabledAt: new Date(),
    disabledReason: cleanText(input.reason) || "Disabled by owner.",
  }),
);
export const enableDraft = protectedOS.drafts.enable.handler(({ context: ctx, input }) =>
  updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
    disabledAt: null,
    disabledReason: null,
  }),
);
export const uploadDraft = publicOS.drafts.upload
  .use(
    ratelimit({
      limiter: ({ context }) => context.rateLimiters["upload-ip"],
      key: ({ context }) => context.sourceIp || "anonymous",
    }),
  )
  .use(
    ratelimit({
      limiter: ({ context }) => context.rateLimiters["upload-key"],
      key: ({ context }) => context.apiKey?.id ?? publicUploadAuth.id,
    }),
  )
  .handler(async ({ context: ctx, input, errors }) => {
    if (ctx.session && !ctx.apiKey)
      throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
    const result = await persistUpload(ctx, input);
    if (!result.ok)
      throw errors.UNPROCESSABLE_CONTENT({
        message: "HTML validation failed.",
        data: result,
      });
    return { status: result.versionNumber === 1 ? (201 as const) : (200 as const), body: result };
  });
