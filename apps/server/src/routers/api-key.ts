import { ORPCError } from "@orpc/server";
import {
  createApiKey as insertApiKey,
  listAccountApiKeys,
  revokeApiKey as revokeAccountApiKey,
} from "@postplan/database";
import { protectedOS } from "../orpc.js";

export const listApiKeys = protectedOS.apiKeys.list.handler(({ context: ctx }) =>
  listAccountApiKeys(ctx.db, ctx.account.accountId),
);
export const createApiKey = protectedOS.apiKeys.create.handler(({ context: ctx, input }) => {
  ctx.limit("key-mint", ctx.account.accountId);
  return insertApiKey(ctx.db, ctx.account.accountId, input.name || "CLI API Key");
});
export const revokeApiKey = protectedOS.apiKeys.revoke.handler(async ({ context: ctx, input }) => {
  if (!(await revokeAccountApiKey(ctx.db, ctx.account.accountId, input.apiKeyId)))
    throw new ORPCError("NOT_FOUND", { message: "API key not found." });
  return { ok: true };
});
