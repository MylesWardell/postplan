import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import { implement, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
import type { BaseContext } from "./context";
import { resolveApiContext } from "#lib/api-context";

export const publicOS = implement(contract)
  .$context<ResponseHeadersHandlerPluginContext & BaseContext>()
  .use(async ({ context, next }) =>
    next({ context: await resolveApiContext(context, context.resHeaders) }),
  );

export const protectedOS = publicOS.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.accountId, accountName: context.apiKey.accountName }
    : context.session;
  if (!account) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  }
  return next({ context: { account } });
});
