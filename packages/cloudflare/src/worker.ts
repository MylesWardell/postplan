import "./instrumentation";

import { env as bindings } from "cloudflare:workers";

import { createApplication } from "@postplan/web/application";
import { renderFrontend } from "@postplan/web/astro-render";

import { applicationStorage } from "./application-storage";
import { cleanup } from "./cleanup";
import { createCloudflareStore } from "./database";
import { handleCloudflareRequest } from "./request-pipeline";
export { RateLimit } from "./rate-limit";

// Build immutable routers once per isolate; request context is still created
// inside the application. No I/O or per-request values are retained here.
const application = createApplication(
  {
    store: createCloudflareStore(bindings).store,
    ...applicationStorage(bindings.POSTPLAN_DB, bindings.HTML_BUCKET),
  },
  { compressResponse: false, enableEvlog: false, renderFrontend },
);

export default {
  async scheduled(_event, env) {
    if (String(env.POSTPLAN_APPLICATION_ENABLED) === "true") {
      await cleanup(env);
    }
  },
  async fetch(incoming, env) {
    return handleCloudflareRequest(incoming, env, application);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
