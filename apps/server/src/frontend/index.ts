import type { ContextFactory, ServerDependencies } from "#context";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
import { draftResponse } from "./routes/drafts.js";
import { webResponse } from "./routes/web.js";
import { messageResponse, notFoundResponse } from "./pages.js";

export function createFrontend(deps: ServerDependencies, context: ContextFactory) {
  return (request: Request, peerIp: string | null) =>
    respond(
      async () => {
        const draftId = hostDraftId(request);
        return (
          (await draftResponse(request, deps, draftId)) ??
          (!draftId ? await webResponse(request, deps.db, context, peerIp) : undefined) ??
          notFoundResponse()
        );
      },
      // Page routes render HTML errors rather than oRPC JSON.
      (failure, status) =>
        messageResponse(
          "Request could not be completed",
          status >= 500 ? "Please try again in a moment." : failure.message,
          status,
        ),
    );
}
