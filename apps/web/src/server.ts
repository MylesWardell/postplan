import { createApplication as createBaseApplication } from "./application";
import type { ServerDependencies } from "./context";
import { renderFrontend } from "./astro-render";

import { config } from "./config";
import { createRuntimeStore } from "#db/client";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "#lib/s3";

export const createApplication = (deps: ServerDependencies) =>
  createBaseApplication(deps, { renderFrontend });

export { config };

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
