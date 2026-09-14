import handler from "@tanstack/react-start/server-entry";
import { createContextFactory } from "./context.js";
import type { ServerDependencies } from "./context.js";
import { createApiHandler } from "./api.js";
import { config } from "./config.js";
import { draftResponse } from "#frontend/drafts";
import { notFoundResponse } from "#frontend/response.server";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
import { createDatabase } from "#db/client";
import { seedAccounts } from "#routers/account-store";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "#lib/s3";

export { config };

export function createApplication(deps: ServerDependencies) {
  const createContext = createContextFactory(deps);
  const api = createApiHandler(createContext);
  return (request: Request, peerIp: string | null = null) =>
    respond(async () => {
      const draftId = hostDraftId(request);
      const draft = await draftResponse(request, deps, draftId);
      if (draft) return draft;
      if (draftId) return notFoundResponse();
      return handler.fetch(request, { context: { deps, createContext, api, peerIp } });
    });
}

let application: Promise<ReturnType<typeof createApplication>> | undefined;
export default {
  async fetch(request: Request) {
    application ??= (async () => {
      assertStorageConfigured();
      const { db } = createDatabase(config.databasePath);
      await seedAccounts(db, config.bootstrapApiKey);
      return createApplication({ db, putHtml: putHtmlObject, getHtml: getHtmlObject });
    })();
    return (await application)(request);
  },
};
