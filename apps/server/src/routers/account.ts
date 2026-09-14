import { protectedOS } from "#orpc";

export const getAccount = protectedOS.account.me.handler(({ context: ctx }) => ({
  accountId: ctx.account.accountId,
  accountName: ctx.account.accountName,
  apiKeyId: ctx.apiKey?.id ?? null,
  apiKeyName: ctx.apiKey?.name ?? null,
}));
