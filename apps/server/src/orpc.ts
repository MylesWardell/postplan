import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import { implement, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
import type { ApiContext } from "./context.js";

export const publicOS = implement(contract)
  .$context<ResponseHeadersHandlerPluginContext & { resolveContext: () => Promise<ApiContext> }>()
  .use(async ({ context, next }) => {
    const resolved = await context.resolveContext();
    if (resolved.requestId) context.resHeaders?.set("X-Request-Id", resolved.requestId);
    try {
      return await next({ context: resolved });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "TOO_MANY_REQUESTS")
        context.resHeaders?.set("Retry-After", "60");
      throw error;
    }
  });
export const protectedOS = publicOS.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.account_id, accountName: context.apiKey.account_name }
    : context.session;
  if (!account)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  return next({ context: { account } });
});
