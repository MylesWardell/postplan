import handler from "@tanstack/react-start/server-entry";
import { createContextFactory } from "./context";
import type { ServerDependencies } from "./context";
import { createApiHandler } from "./api";
import { config } from "./config";
import { draftResponse } from "#frontend/drafts";
import { notFoundResponse } from "#frontend/response.server";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
import { createRuntimeStore } from "#db/client";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "#lib/s3";

export { config };

export function createApplication(deps: ServerDependencies) {
  const createContext = createContextFactory(deps);
  const api = createApiHandler(createContext);
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

let application: Promise<ReturnType<typeof createApplication>> | undefined;
export default {
  async fetch(request: Request) {
    application ??= (async () => {
      assertStorageConfigured();
      const { store } = createRuntimeStore();
      await store.initialize({ bootstrapKey: config.bootstrapApiKey });
      return createApplication({ store, putHtml: putHtmlObject, getHtml: getHtmlObject });
    })();
    return (await application)(request);
  },
};
