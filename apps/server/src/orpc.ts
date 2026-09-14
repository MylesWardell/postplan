import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import { implement, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
import type { ApiContext } from "./context.js";

export const publicOS = implement(contract)
  .$context<ResponseHeadersHandlerPluginContext & { resolveContext: () => Promise<ApiContext> }>()
  .use(async ({ context, next }) => {
    const resolved = await context.resolveContext();
    if (resolved.requestId) context.resHeaders?.set("X-Request-Id", resolved.requestId);
    return next({ context: resolved });
  });
export const protectedOS = publicOS.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.accountId, accountName: context.apiKey.accountName }
    : context.session;
  if (!account)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  return next({ context: { account } });
});
