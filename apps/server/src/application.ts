import handler from "@tanstack/react-start/server-entry";
import { createContextFactory } from "./context";
import type { ServerDependencies } from "./context";
import { createApiHandler } from "./api";
import { draftResponse } from "#frontend/drafts";
import { notFoundResponse } from "#frontend/response.server";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
export function createApplication(deps: ServerDependencies, compressResponse = true) {
  const createContext = createContextFactory(deps);
  const api = createApiHandler(createContext, compressResponse);
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
      return handler.fetch(request, { context: { deps, createContext, api, peerIp } });
    });
}
