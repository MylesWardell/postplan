import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";
import { createContextFactory } from "./context";
import type { ServerDependencies } from "./context";
import { createApiHandler } from "./api";
import { draftResponse } from "#frontend/drafts";
import { notFoundResponse } from "#frontend/response.server";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
import { applyContentSecurityPolicy, createNonce } from "#lib/content-security-policy";

// Pages have no Suspense boundaries, so render to a string: streaming SSR encodes
// every chunk and pipes it through router transform streams for no benefit.
const handler = { fetch: createStartHandler(defaultRenderHandler) };
export interface ApplicationOptions {
  compressResponse?: boolean;
  enableEvlog?: boolean;
}

export function createApplication(deps: ServerDependencies, options: ApplicationOptions = {}) {
  const createContext = createContextFactory(deps);
  const api = createApiHandler(createContext, {
    compressResponse: options.compressResponse ?? true,
    enableEvlog: options.enableEvlog ?? true,
  });
  return (request: Request, peerIp: string | null = null) =>
    respond(async () => {
      const draftId = hostDraftId(request);
      const draft = await draftResponse(request, deps, draftId);
      if (draft) {
        return draft;
      }
      if (draftId) {
        return notFoundResponse();
      }
      const path = new URL(request.url).pathname;
      if (path === "/api" || path.startsWith("/api/")) {
        // API authentication, CORS and body limits belong to oRPC. Avoid the
        // page router; Start's CSRF middleware applies only to server functions.
        const response = await api(request, peerIp);
        return response.headers.get("content-type")?.includes("text/html")
          ? applyContentSecurityPolicy(response, createNonce())
          : response;
      }
      return handler.fetch(request, { context: { deps, createContext, api, peerIp } });
    });
}
