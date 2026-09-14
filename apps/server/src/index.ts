import { serve } from "bun";
import { createDatabase, seedAccounts } from "@postplan/database";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";
import { maxBodyBytes } from "./http/body.js";
import { RPCHandler } from "@orpc/server/fetch";
import { sql } from "drizzle-orm";
import { router } from "./routers/index.js";
import { config } from "./config.js";
import { createContextFactory } from "./http/context.js";
import type { ServerDependencies } from "./http/context.js";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { uploadRejected } from "@postplan/api";
import { draftResponse } from "./http/drafts.js";
import { webResponse } from "./http/web.js";
import { errorResponse } from "./http/errors.js";
import { boundedRequest } from "./http/body.js";
import { getDraftIdFromHost } from "./http/public-url.js";
import { notFoundResponse } from "./views/pages.js";

// Bun Fetch entry point, also callable directly by integration tests.
export function createApp(deps: ServerDependencies) {
  const context = createContextFactory(deps);
  const rpc = new RPCHandler(router);
  const api = new OpenAPIHandler(router, {
    customErrorResponseBodyEncoder: (error) => {
      if (error.code === "UNPROCESSABLE_CONTENT") {
        const result = uploadRejected.safeParse(error.data);
        if (result.success) return result.data;
      }
      return { ok: false, error: error.message };
    },
  });
  return async (request: Request, peerIp: string | null = null): Promise<Response> => {
    let response: Response;
    try {
      const url = new URL(request.url);
      const draftId = getDraftIdFromHost({
        publicBaseUrl: config.publicBaseUrl,
        host: url.hostname,
      });
      if (url.pathname === "/healthz" && request.method === "GET" && !draftId) {
        try {
          await deps.db.execute(sql`select 1`);
          response = Response.json({ ok: true });
        } catch {
          response = Response.json({ ok: false }, { status: 503 });
        }
      } else if (!draftId && (url.pathname === "/rpc" || url.pathname.startsWith("/rpc/"))) {
        const req = await boundedRequest(request);
        response =
          (
            await rpc.handle(req, {
              prefix: "/rpc",
              context: { resolveContext: () => context(req, true, peerIp) },
            })
          ).response ?? notFoundResponse();
      } else if (!draftId && url.pathname.startsWith("/api/")) {
        const req = await boundedRequest(request);
        response =
          (
            await api.handle(req, {
              prefix: "/api",
              context: { resolveContext: () => context(req, false, peerIp) },
            })
          ).response ?? notFoundResponse();
      } else {
        response =
          (await draftResponse(request, deps, draftId)) ??
          (!draftId
            ? await webResponse(await boundedRequest(request), deps.db, context, peerIp)
            : undefined) ??
          notFoundResponse();
      }
    } catch (error) {
      response = errorResponse(error);
    }
    if (response.status === 429) response.headers.set("Retry-After", "60");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "same-origin");
    return response;
  };
}

async function main(): Promise<void> {
  assertStorageConfigured();
  const { db, pool } = createDatabase(config);
  await seedAccounts(db, config.bootstrapApiKey);
  const app = createApp({ db, putHtml: putHtmlObject, getHtml: getHtmlObject });
  const server = serve({
    port: config.port,
    maxRequestBodySize: maxBodyBytes,
    fetch: (req, server) => app(req, server.requestIP(req)?.address ?? null),
  });
  console.log(`Postplan listening on port ${server.port}`);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, async () => {
      if (stopping) return;
      stopping = true;
      console.log(`Received ${signal}; shutting down.`);
      // Drain before closing PostgreSQL; keep below ECS's task stop timeout.
      const force = setTimeout(
        () => process.exit(1),
        Number(process.env.SHUTDOWN_GRACE_MS || 20_000),
      );
      force.unref();
      try {
        await server.stop();
        await pool.end();
        process.exit(0);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    });
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
