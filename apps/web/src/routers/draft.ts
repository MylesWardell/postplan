import { ratelimit } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";
import { publicUploadAuth, cleanText } from "@postplan/store";
import { publicOS, protectedOS } from "#orpc";
import { config } from "#config";

// Opaque keyset cursor: the last row's update time and id.
function encodeCursor(draft: { updatedAt: Date; draftId: string }) {
  return Buffer.from(JSON.stringify([draft.updatedAt.getTime(), draft.draftId])).toString(
    "base64url",
  );
}
function decodeCursor(cursor: string) {
  try {
    const [updatedAt, draftId] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Number.isSafeInteger(updatedAt) && typeof draftId === "string" && draftId) {
      return { updatedAt: new Date(updatedAt), draftId };
    }
  } catch {
    // Reported below.
  }
  throw new ORPCError("BAD_REQUEST", { message: "Invalid draft list cursor." });
}

export const listDrafts = protectedOS.drafts.list.handler(async ({ context: ctx, input }) => {
  const { drafts, hasMore } = await ctx.store.drafts.list({
    accountId: ctx.account.accountId,
    context: ctx,
    limit: input.limit,
    after: input.cursor === undefined ? undefined : decodeCursor(input.cursor),
    q: input.q || undefined,
    status: input.status,
  });
  const last = drafts.at(-1);
  return { ok: true, drafts, nextCursor: hasMore && last ? encodeCursor(last) : null };
});
export const listDraftTotals = protectedOS.drafts.totals.handler(({ context: ctx }) =>
  ctx.store.drafts.totals({ accountId: ctx.account.accountId }),
);
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
