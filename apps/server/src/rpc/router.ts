import { implement, createRouterClient, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
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
} from "../services/drafts.js";

const base = implement(contract)
  .$context<{ resolveContext: () => Promise<ApiContext> }>()
  .use(async ({ context, next }) => next({ context: await context.resolveContext() }));
const authenticated = base.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.account_id, accountName: context.apiKey.account_name }
    : context.session;
  if (!account)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  return next({ context: { account } });
});
export const router = base.router({
  account: {
    me: authenticated.account.me.handler(({ context: ctx }) => ({
      accountId: ctx.account.accountId,
      accountName: ctx.account.accountName,
      apiKeyId: ctx.apiKey?.id ?? null,
      apiKeyName: ctx.apiKey?.name ?? null,
    })),
  },
  drafts: {
    list: authenticated.drafts.list.handler(async ({ context: ctx }) => ({
      ok: true,
      drafts: await listAccountDrafts(ctx.db, ctx.account.accountId, ctx),
    })),
    detail: authenticated.drafts.detail.handler(async ({ context: ctx, input }) => {
      const result = await getAccountDraftWithVersions(
        ctx.db,
        ctx.account.accountId,
        input.draftId,
        ctx,
      );
      if (!result) throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
      return result;
    }),
    update: authenticated.drafts.update.handler(({ context: ctx, input: { draftId, ...values } }) =>
      updateOwnedDraft(ctx.db, ctx.account.accountId, draftId, values),
    ),
    delete: authenticated.drafts.delete.handler(({ context: ctx, input }) =>
      updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, { deleted_at: new Date() }),
    ),
    disable: authenticated.drafts.disable.handler(({ context: ctx, input }) =>
      updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
        disabled_at: new Date(),
        disabled_reason: cleanText(input.reason) || "Disabled by owner.",
      }),
    ),
    enable: authenticated.drafts.enable.handler(({ context: ctx, input }) =>
      updateOwnedDraft(ctx.db, ctx.account.accountId, input.draftId, {
        disabled_at: null,
        disabled_reason: null,
      }),
    ),
    upload: base.drafts.upload.handler(async ({ context: ctx, input }) => {
      ctx.limit("upload-ip", ctx.sourceIp || "anonymous");
      ctx.limit("upload-key", ctx.apiKey?.id ?? publicUploadAuth.id);
      if (ctx.session && !ctx.apiKey)
        throw new ORPCError("UNAUTHORIZED", { message: "Use an API key to upload drafts." });
      const result = await uploadDraft(ctx, input);
      if (!result.ok)
        throw new ORPCError("UNPROCESSABLE_ENTITY", {
          message: "HTML validation failed.",
          data: result,
        });
      return { status: result.versionNumber === 1 ? (201 as const) : (200 as const), body: result };
    }),
  },
  apiKeys: {
    list: authenticated.apiKeys.list.handler(({ context: ctx }) =>
      listAccountApiKeys(ctx.db, ctx.account.accountId),
    ),
    create: authenticated.apiKeys.create.handler(({ context: ctx, input }) => {
      ctx.limit("key-mint", ctx.account.accountId);
      return createApiKey(ctx.db, ctx.account.accountId, input.name || "CLI API Key");
    }),
    revoke: authenticated.apiKeys.revoke.handler(async ({ context: ctx, input }) => {
      if (!(await revokeApiKey(ctx.db, ctx.account.accountId, input.apiKeyId)))
        throw new ORPCError("NOT_FOUND", { message: "API key not found." });
      return { ok: true };
    }),
  },
});
export const createCaller = (context: ApiContext) =>
  createRouterClient(router, { context: { resolveContext: async () => context } });
