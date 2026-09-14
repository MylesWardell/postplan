import type { ContextFactory, ServerDependencies } from "../http/context.js";
import { draftResponse } from "../http/drafts.js";
import { webResponse } from "../http/web.js";
import { boundedRequest } from "../http/body.js";
import { hostDraftId, respond } from "../http/response.js";
import { notFoundResponse } from "./pages.js";

export function createFrontend(deps: ServerDependencies, context: ContextFactory) {
  return (request: Request, peerIp: string | null) =>
    respond(async () => {
      const draftId = hostDraftId(request);
      return (
        (await draftResponse(request, deps, draftId)) ??
        (!draftId
          ? await webResponse(await boundedRequest(request), deps.db, context, peerIp)
          : undefined) ??
        notFoundResponse()
      );
    });
}
