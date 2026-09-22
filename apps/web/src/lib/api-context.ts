import { ORPCError } from "@orpc/server";

import { assertApplicationOrigin, readSession } from "#auth/session";
import { config } from "#config";
import type { ApiContext, BaseContext } from "#context";
import { clientIp } from "#lib/client-ip";
import { getRequestBaseUrl } from "@postplan/store/public-url";

// Shared authentication/metadata for direct HTTP uploads and the remaining oRPC API.
export async function resolveApiContext(base: BaseContext, headers?: Headers): Promise<ApiContext> {
  const { request, peerIp, store, allowSession } = base;
  const requestId = request.headers.get(config.requestIdHeader)?.slice(0, 255) ?? null;
  if (requestId) {
    headers?.set("X-Request-Id", requestId);
  }
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKey = token ? await store.accounts.findApiKey({ token }) : null;
  if (authorization && !apiKey) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid API key." });
  }
  const session = allowSession && !authorization ? readSession(request) : null;
  if (session) {
    assertApplicationOrigin(request);
  }
  return {
    ...base,
    apiKey,
    session,
    requestId,
    requestBaseUrl: getRequestBaseUrl(request),
    publicBaseUrl: config.publicBaseUrl,
    sourceIp: clientIp(request, peerIp),
    userAgent: request.headers.get("user-agent") ?? null,
    maxHtmlBytes: config.maxHtmlBytes,
  };
}
