import { ratelimit } from "@orpc/ratelimit";
import { ORPCError } from "@orpc/server";
import { protectedOS } from "#orpc";

export const listApiKeys = protectedOS.apiKeys.list.handler(({ context: ctx }) =>
  ctx.store.accounts.listApiKeys({ accountId: ctx.account.accountId }),
);
export const createApiKey = protectedOS.apiKeys.create
  .use(
    ratelimit({
      limiter: ({ context }) => context.rateLimiters["key-mint"],
      key: ({ context }) => context.account.accountId,
    }),
  )
  .handler(({ context: ctx, input }) => {
    return ctx.store.accounts.createApiKey({
      accountId: ctx.account.accountId,
      name: input.name || "CLI API Key",
    });
  });
export const revokeApiKey = protectedOS.apiKeys.revoke.handler(async ({ context: ctx, input }) => {
  if (
    !(await ctx.store.accounts.revokeApiKey({
      accountId: ctx.account.accountId,
      id: input.apiKeyId,
    }))
  ) {
    throw new ORPCError("NOT_FOUND", { message: "API key not found." });
  }
  return { ok: true };
});
