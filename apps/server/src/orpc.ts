import { implement, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
import type { ApiContext } from "./context.js";

export const publicOS = implement(contract)
  .$context<{ resolveContext: () => Promise<ApiContext> }>()
  .use(async ({ context, next }) => next({ context: await context.resolveContext() }));
export const protectedOS = publicOS.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.account_id, accountName: context.apiKey.account_name }
    : context.session;
  if (!account)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  return next({ context: { account } });
});
