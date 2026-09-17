import "./instrumentation";
import { createCloudflareStore } from "./database";
import { createApplication } from "@postplan/web/application";
import { applicationStorage } from "./application-storage";
import { cleanup } from "./cleanup";
import { handleCloudflareRequest } from "./request-pipeline";
import { env as bindings } from "cloudflare:workers";
export { RateLimit } from "./rate-limit";

// Build immutable routers once per isolate; request context is still created
// inside the application. No I/O or per-request values are retained here.
const application = createApplication(
  {
    store: createCloudflareStore(bindings).store,
    ...applicationStorage(bindings.POSTPLAN_DB, bindings.HTML_BUCKET),
  },
  { compressResponse: false, enableEvlog: false },
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
