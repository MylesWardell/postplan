import { ratelimit } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";
import {
  createApiKey as insertApiKey,
  listAccountApiKeys,
  revokeApiKey as revokeAccountApiKey,
} from "./account-store";
import { protectedOS } from "#orpc";

export const listApiKeys = protectedOS.apiKeys.list.handler(({ context: ctx }) =>
  listAccountApiKeys(ctx.db, ctx.account.accountId),
);
export const createApiKey = protectedOS.apiKeys.create
  .use(
    ratelimit({
      limiter: ({ context }) => context.rateLimiters["key-mint"],
      key: ({ context }) => context.account.accountId,
    }),
  )
  .handler(({ context: ctx, input }) => {
    return insertApiKey(ctx.db, ctx.account.accountId, input.name || "CLI API Key");
  });
export const revokeApiKey = protectedOS.apiKeys.revoke.handler(async ({ context: ctx, input }) => {
  if (!(await revokeAccountApiKey(ctx.db, ctx.account.accountId, input.apiKeyId))) {
    throw new ORPCError("NOT_FOUND", { message: "API key not found." });
  }
  return { ok: true };
});
