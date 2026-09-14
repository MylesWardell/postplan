import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import { implement, ORPCError } from "@orpc/server";
import { contract } from "@postplan/api";
import type { BaseContext } from "./context.js";
import { config } from "./config.js";
import { clientIp } from "./lib/client-ip.js";
import { getRequestBaseUrl } from "./lib/public-url.js";
import { assertApplicationOrigin, readSession } from "./auth/session.js";
import { findApiKeyByToken } from "./routers/account-store.js";

export const publicOS = implement(contract)
  .$context<ResponseHeadersHandlerPluginContext & BaseContext>()
  // Request metadata: echo the edge request id and capture caller details.
  .use(({ context: { request, peerIp, resHeaders }, next }) => {
    const requestId = request.headers.get(config.requestIdHeader)?.slice(0, 255) ?? null;
    if (requestId) resHeaders?.set("X-Request-Id", requestId);
    return next({
      context: {
        requestId,
        requestBaseUrl: getRequestBaseUrl(request),
        publicBaseUrl: config.publicBaseUrl,
        sourceIp: clientIp(request, peerIp),
        userAgent: request.headers.get("user-agent") ?? null,
        maxHtmlBytes: config.maxHtmlBytes,
      },
    });
  })
  // Optional authentication: a Bearer key wins; otherwise a web session if allowed.
  // A presented-but-invalid key is always rejected rather than treated as anonymous.
  .use(async ({ context: { db, request, allowSession }, next }) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const apiKey = token ? await findApiKeyByToken(db, token) : null;
    if (authorization && !apiKey)
      throw new ORPCError("UNAUTHORIZED", { message: "Invalid API key." });
    const session = allowSession && !authorization ? readSession(request) : null;
    if (session) assertApplicationOrigin(request);
    return next({ context: { apiKey, session } });
  });

export const protectedOS = publicOS.use(({ context, next }) => {
  const account = context.apiKey
    ? { accountId: context.apiKey.account_id, accountName: context.apiKey.account_name }
    : context.session;
  if (!account)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in or provide a valid API key." });
  return next({ context: { account } });
});
