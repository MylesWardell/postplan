import { createCloudflareStore } from "./database";
import { createApplication } from "@postplan/server/application";
import { cloudflareGateway } from "./gateway";
import { r2Storage } from "./r2";
import { authorizedProbe, runProbe } from "./probe";
export { RateLimit } from "./rate-limit";

export default {
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
    if (draftHost) {
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
      // Count bytes while reading: Content-Length is not a trustworthy bound.
      const reader = request.body?.getReader();
      if (!reader) {
        return new Response("HTML body required", { status: 400 });
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        size += part.value.byteLength;
        if (size > 512 * 1024) {
          await reader.cancel();
          return new Response("HTML too large", { status: 413 });
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return runProbe(env, new TextDecoder().decode(bytes));
    }
    if (path.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }
    if (!["/", "/healthz", "/api/spec.json"].includes(path)) {
      return new Response(
        "Cloudflare compatibility experiment: application data routes are not enabled.",
        { status: 503 },
      );
    }
    const { store } = createCloudflareStore(env);
    // The edge handles compression; workerd otherwise strips the plugin's encoding header.
    return createApplication({ store, ...r2Storage(env.HTML_BUCKET) }, false)(request, peerIp);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
