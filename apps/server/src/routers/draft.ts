import { ratelimit } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";
import { publicUploadAuth, cleanText } from "@postplan/store";
import { publicOS, protectedOS } from "#orpc";
import { config } from "#config";

export const listDrafts = protectedOS.drafts.list.handler(async ({ context: ctx }) => ({
  ok: true,
  drafts: await ctx.store.drafts.list({ accountId: ctx.account.accountId, context: ctx }),
}));
export const getDraft = protectedOS.drafts.detail.handler(async ({ context: ctx, input }) => {
  const result = await ctx.store.drafts.detail({
    accountId: ctx.account.accountId,
    draftId: input.draftId,
    context: ctx,
  });
  if (!result) {
    throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  }
  return result;
});
export const updateDraft = protectedOS.drafts.update.handler(
  ({ context: ctx, input: { draftId, ...values } }) =>
    ctx.store.drafts.update({ accountId: ctx.account.accountId, draftId: draftId, values: values }),
);
export const deleteDraft = protectedOS.drafts.delete.handler(({ context: ctx, input }) =>
  ctx.store.drafts.update({
    accountId: ctx.account.accountId,
    draftId: input.draftId,
    values: { deletedAt: new Date() },
  }),
);
export const disableDraft = protectedOS.drafts.disable.handler(({ context: ctx, input }) =>
  ctx.store.drafts.update({
    accountId: ctx.account.accountId,
    draftId: input.draftId,
    values: {
      disabledAt: new Date(),
      disabledReason: cleanText(input.reason) || "Disabled by owner.",
    },
  }),
);
export const enableDraft = protectedOS.drafts.enable.handler(({ context: ctx, input }) =>
  ctx.store.drafts.update({
    accountId: ctx.account.accountId,
    draftId: input.draftId,
    values: {
      disabledAt: null,
      disabledReason: null,
    },
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
    if (!config.allowAnonymousUploads && !ctx.apiKey) {
      throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
    }
    if (ctx.session && !ctx.apiKey) {
      throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
    }
    const result = await ctx.store.drafts.upload({ context: ctx, input: input });
    if (!result.ok) {
      throw errors.UNPROCESSABLE_CONTENT({
        message: "HTML validation failed.",
        data: result,
      });
    }
    return { status: result.versionNumber === 1 ? (201 as const) : (200 as const), body: result };
  });
