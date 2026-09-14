import handler from "@tanstack/react-start/server-entry";
import { createContextFactory } from "./http/context.js";
import type { ServerDependencies } from "./http/context.js";
import { createApiHandler } from "./http/api.js";
import { draftResponse } from "./http/drafts.js";
import { hostDraftId, respond } from "./http/response.js";
import { notFoundResponse } from "./frontend/response.server.js";
import { config } from "./config.js";
import { createDatabase } from "./db/client.js";
import { seedAccounts } from "./routers/account-store.js";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";

export { config };

export function createApplication(deps: ServerDependencies) {
  const resolveContext = createContextFactory(deps);
  const api = createApiHandler(resolveContext);
  return (request: Request, peerIp: string | null = null) =>
    respond(async () => {
      const draftId = hostDraftId(request);
      const draft = await draftResponse(request, deps, draftId);
      if (draft) return draft;
      if (draftId) return notFoundResponse();
      return handler.fetch(request, { context: { deps, resolveContext, api, peerIp } });
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
