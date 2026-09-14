import { shutdownInstrumentation } from "./instrumentation.js";
import { serve } from "bun";
import type { Server, ServerWebSocket } from "bun";
import { RPCHandler } from "@orpc/server/websocket";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { CORSHandlerPlugin } from "@orpc/server/plugins";
import { EvlogHandlerPlugin } from "@orpc/evlog";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract, uploadRejected } from "@postplan/api";
import { sql } from "drizzle-orm";
import { createDatabase } from "./db/client.js";
import { seedAccounts } from "./routers/account-store.js";
import { router } from "./routers/index.js";
import { config } from "./config.js";
import { createContextFactory } from "./http/context.js";
import type { ServerDependencies } from "./http/context.js";
import { maxBodyBytes, boundedRequest } from "./http/body.js";
import { hostDraftId, applicationOrigin, onlyApplication, respond } from "./http/response.js";
import { createFrontend } from "./frontend/index.js";
import { notFoundResponse } from "./frontend/pages.js";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";

interface SocketData {
  request: Request;
  peerIp: string | null;
}

// Tests and production use the same native Bun routes and WebSocket lifecycle.
export function createServerOptions(deps: ServerDependencies) {
  const context = createContextFactory(deps);
  const index = createFrontend(deps, context);
  const zodConverter = new ZodToJsonSchemaConverter();
  const openapiGenerator = new OpenAPIGenerator({
    converters: [zodConverter],
  });
  const openapiHandler = new OpenAPIHandler(router, {
    plugins: [
      new CORSHandlerPlugin({
        allowHeaders: ["Content-Disposition", "Standard-Server", "Content-Type", "Authorization"],
        exposeHeaders: ["Content-Disposition", "Standard-Server", "Retry-After"],
      }),
      new EvlogHandlerPlugin({ logAbort: true }),
      new SmartCoercionHandlerPlugin({ converters: [zodConverter] }),
      new OpenAPIReferenceHandlerPlugin({
        spec: () =>
          openapiGenerator.generate(contract, {
            customErrorResponseBodySchema: (_errors, status) =>
              status === 422
                ? zodConverter.convert(uploadRejected, "output")[0]
                : {
                    type: "object",
                    properties: { ok: { const: false }, error: { type: "string" } },
                    required: ["ok", "error"],
                  },
            base: {
              info: { title: "Postplan API", version: "1.0.0" },
              servers: [{ url: "/api" }],
              components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
            },
          }),
        providerConfig: { authentication: { securitySchemes: { bearerAuth: {} } } },
      }),
    ],
    customErrorResponseBodyEncoder: (error) => {
      if (error.code === "UNPROCESSABLE_CONTENT") {
        const result = uploadRejected.safeParse(error.data);
        if (result.success) return result.data;
      }
      return { ok: false, error: error.message };
    },
  });
  const rpcHandler = new RPCHandler(router, {
    plugins: [new EvlogHandlerPlugin({ logAbort: true })],
  });

  function handleOpenAPIRequest(request: Request, server: Server<SocketData>) {
    return onlyApplication(request, async () => {
      const req = await boundedRequest(request);
      const { response } = await openapiHandler.handle(req, {
        prefix: "/api",
        context: {
          resolveContext: () => context(req, false, server.requestIP(request)?.address ?? null),
        },
      });
      return response ?? notFoundResponse();
    });
  }

  return {
    maxRequestBodySize: maxBodyBytes,
    routes: {
      "/*": (req: Request, server: Server<SocketData>) =>
        index(req, server.requestIP(req)?.address ?? null),
      "/api": handleOpenAPIRequest,
      "/api/*": handleOpenAPIRequest,
      "/healthz": (req: Request) =>
        onlyApplication(req, async () => {
          if (req.method !== "GET") return notFoundResponse();
          try {
            await deps.db.execute(sql`select 1`);
            return Response.json({ ok: true });
          } catch {
            return Response.json({ ok: false }, { status: 503 });
          }
        }),
      "/ws/rpc": (req: Request, server: Server<SocketData>) => {
        if (hostDraftId(req)) return respond(notFoundResponse);
        const origin = req.headers.get("origin");
        // Browser cookies must never authorize a cross-origin socket. Per-call headers cannot override this.
        if (
          (origin && origin !== applicationOrigin(req)) ||
          (req.headers.has("cookie") && !origin)
        ) {
          return respond(() => new Response("Forbidden", { status: 403 }));
        }
        if (
          server.upgrade(req, {
            data: { request: req, peerIp: server.requestIP(req)?.address ?? null },
          })
        )
          return;
        return respond(() => new Response("Upgrade failed", { status: 500 }));
      },
    },
    websocket: {
      maxPayloadLength: maxBodyBytes,
      message(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
        return rpcHandler
          .message(ws, typeof message === "string" ? message : new Uint8Array(message), {
            context: (request) => ({
              resolveContext: () => {
                // Authenticate every call, including key revocation and session expiry on an existing connection.
                const headers = new Headers(ws.data.request.headers);
                const authorization = request.headers.authorization;
                if (authorization !== undefined)
                  headers.set(
                    "authorization",
                    Array.isArray(authorization) ? authorization.join(",") : authorization,
                  );
                const req = new Request(ws.data.request.url, { method: "POST", headers });
                return context(req, true, ws.data.peerIp);
              },
            }),
          })
          .then(() => {});
      },
      close(ws: ServerWebSocket<SocketData>) {
        void rpcHandler.close(ws);
      },
    },
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  };
}

async function main(): Promise<void> {
  assertStorageConfigured();
  const { db, pool } = createDatabase(config);
  await seedAccounts(db, config.bootstrapApiKey);
  const server = serve({
    port: config.port,
    ...createServerOptions({ db, putHtml: putHtmlObject, getHtml: getHtmlObject }),
  });
  console.log(`Postplan listening at ${server.url}`);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, async () => {
      if (stopping) return;
      stopping = true;
      const force = setTimeout(
        () => process.exit(1),
        Number(process.env.SHUTDOWN_GRACE_MS || 20_000),
      );
      force.unref();
      try {
        await server.stop();
        await pool.end();
        await shutdownInstrumentation();
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
