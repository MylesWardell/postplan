import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createApiKey,
  listAccountApiKeys,
  publicUploadAuth,
  revokeApiKey,
} from "@postplan/database";
import type { ApiContext } from "./context.js";
import {
  cleanText,
  getAccountDraftWithVersions,
  listAccountDrafts,
  updateOwnedDraft,
  uploadDraft,
} from "./drafts.js";

const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error." : shape.message,
      data: { ...shape.data, stack: undefined },
    };
  },
});
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const account = ctx.apiKey
    ? { accountId: ctx.apiKey.account_id, accountName: ctx.apiKey.account_name }
    : ctx.session;
  if (!account)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in or provide a valid API key." });
  return next({ ctx: { ...ctx, account } });
});
const draftIdInput = z.object({ draftId: z.string().min(1).max(255) });

export const appRouter = t.router({
  account: t.router({
    me: protectedProcedure.query(({ ctx }) => ({
      accountId: ctx.account.accountId,
      accountName: ctx.account.accountName,
      apiKeyId: ctx.apiKey?.id ?? null,
      apiKeyName: ctx.apiKey?.name ?? null,
    })),
  }),
  drafts: t.router({
    list: protectedProcedure.query(async ({ ctx }) => ({
      ok: true as const,
      drafts: await listAccountDrafts(ctx.db, ctx.account.accountId, ctx),
    })),
    detail: protectedProcedure.input(draftIdInput).query(async ({ ctx, input }) => {
      const result = await getAccountDraftWithVersions(
        ctx.db,
        ctx.account.accountId,
        input.draftId,
        ctx,
      );
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
      return result;
    }),
    update: protectedProcedure
      .input(
        draftIdInput.extend({
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().trim().max(1000).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { draftId, ...values } }) =>
        updateOwnedDraft(ctx.db, ctx.account.accountId, draftId, values),
      ),
    delete: protectedProcedure
      .input(draftIdInput)
      .mutation(({ ctx, input }) =>
        updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, { deleted_at: new Date() }),
      ),
    disable: protectedProcedure
      .input(draftIdInput.extend({ reason: z.string().max(255).optional() }))
      .mutation(({ ctx, input }) =>
        updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
          disabled_at: new Date(),
          disabled_reason: cleanText(input.reason) || "Disabled by owner.",
        }),
      ),
    enable: protectedProcedure.input(draftIdInput).mutation(({ ctx, input }) =>
      updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
        disabled_at: null,
        disabled_reason: null,
      }),
    ),
    upload: t.procedure
      .input(
        z.object({
          html: z.unknown().optional(),
          filename: z.string().optional(),
          draftId: z.string().min(1).optional(),
          description: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        ctx.limit("upload-ip", ctx.sourceIp || "anonymous");
        ctx.limit("upload-key", ctx.apiKey?.id ?? publicUploadAuth.id);
        if (ctx.session && !ctx.apiKey)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Use an API key to upload drafts.",
          });
        return uploadDraft(ctx, input);
      }),
  }),
  apiKeys: t.router({
    list: protectedProcedure.query(({ ctx }) => listAccountApiKeys(ctx.db, ctx.account.accountId)),
    create: protectedProcedure
      .input(z.object({ name: z.string().trim().max(255).optional() }))
      .mutation(({ ctx, input }) => {
        ctx.limit("key-mint", ctx.account.accountId);
        return createApiKey(ctx.db, ctx.account.accountId, input.name || "CLI API Key");
      }),
    revoke: protectedProcedure
      .input(z.object({ apiKeyId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await revokeApiKey(ctx.db, ctx.account.accountId, input.apiKeyId)))
          throw new TRPCError({ code: "NOT_FOUND", message: "API key not found." });
        return { ok: true as const };
      }),
  }),
});
export type AppRouter = typeof appRouter;
export type { ApiContext } from "./context.js";
