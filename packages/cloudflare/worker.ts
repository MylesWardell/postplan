import { createCloudflareStore } from "./database";
import { createApplication } from "@postplan/server/application";
import { cloudflareGateway } from "./gateway";
import { applicationStorage } from "./application-storage";
import { boundedBody } from "./body";
import { authorizedProbe, runProbe } from "./probe";
import { cleanup } from "./cleanup";
import { env as bindings } from "cloudflare:workers";
export { RateLimit } from "./rate-limit";

// Build immutable routers once per isolate; request context is still created
// inside the application. No I/O or per-request values are retained here.
const application = createApplication(
  {
    store: createCloudflareStore(bindings).store,
    ...applicationStorage(bindings.POSTPLAN_DB, bindings.HTML_BUCKET),
  },
  false,
);

export default {
  async scheduled(_event, env) {
    if (String(env.POSTPLAN_APPLICATION_ENABLED) === "true") {
      await cleanup(env);
    }
  },
  async fetch(incoming, env) {
    let gateway;
    try {
      gateway = cloudflareGateway(incoming, {
        publicBaseUrl: env.POSTPLAN_PUBLIC_BASE_URL,
        requestIdHeader: "x-request-id",
        local: env.EXPERIMENT_LOCAL === "true",
      });
    } catch {
      return new Response("Invalid gateway request", { status: 400 });
    }
    const { request, peerIp, draftHost } = gateway;
    const enabled = String(env.POSTPLAN_APPLICATION_ENABLED) === "true";
    if (draftHost && !enabled) {
      return new Response("Not found", { status: 404 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/__experiment/probe") {
      if (!authorizedProbe(request, env.EXPERIMENT_TOKEN)) {
        return new Response("Not found", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const bytes = await boundedBody(request, 512 * 1024);
      if (!bytes) {
        return new Response("HTML too large", { status: 413 });
      }
      return runProbe(env, new TextDecoder().decode(bytes));
    }
    if (!draftHost && path.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }
    if (!enabled && !["/", "/healthz", "/api/spec.json"].includes(path)) {
      return new Response(
        "Cloudflare compatibility experiment: application data routes are not enabled.",
        { status: 503 },
      );
    }
    if (enabled) {
      try {
        const killed = await env.POSTPLAN_DB.prepare(
          "SELECT killed FROM usage_guard WHERE id=1",
        ).first<number>("killed");
        if (killed === 1) {
          return new Response("Application stopped", { status: 503 });
        }
        // Missing migrations fail closed; bootstrap is an explicit deployment step.
        if (
          !(await env.POSTPLAN_DB.prepare("SELECT id FROM application_budget WHERE id=1").first())
        ) {
          throw new Error("Missing budget");
        }
      } catch {
        return new Response("Application storage is not initialized", { status: 503 });
      }
    }
    let applicationRequest = request;
    if (request.body) {
      const body = await boundedBody(request, 2 * 1024 * 1024);
      if (!body) {
        return new Response("Request body too large", { status: 413 });
      }
      applicationRequest = new Request(request, { method: request.method, body });
    }
    // The edge handles compression; workerd otherwise strips the plugin's encoding header.
    return application(applicationRequest, peerIp);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
