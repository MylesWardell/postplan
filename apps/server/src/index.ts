import { RateLimitHandlerPlugin } from "@orpc/ratelimit";
import { shutdownInstrumentation } from "./instrumentation.js";
import { serve } from "bun";
import type { Server } from "bun";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import {
  RequestLimitHandlerPlugin,
  RequestCompressionHandlerPlugin,
  ResponseCompressionHandlerPlugin,
  ResponseHeadersHandlerPlugin,
  CORSHandlerPlugin,
} from "@orpc/server/plugins";
import { EvlogHandlerPlugin } from "@orpc/evlog";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "@postplan/api";
import { sql } from "drizzle-orm";
import { createDatabase } from "./db/client.js";
import { seedAccounts } from "./routers/account-store.js";
import { router } from "./routers/index.js";
import { config } from "./config.js";
import { createContextFactory } from "./context.js";
import type { ServerDependencies } from "./context.js";
import { onlyApplication } from "./lib/host-guard.js";
import { createFrontend } from "./frontend/index.js";
import { notFoundResponse } from "./frontend/pages.js";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";

export function createServerOptions(deps: ServerDependencies) {
  const context = createContextFactory(deps);
  const index = createFrontend(deps, context);
  const zodConverter = new ZodToJsonSchemaConverter();
  const openapiGenerator = new OpenAPIGenerator({
    converters: [zodConverter],
  });
  const openapiHandler = new OpenAPIHandler(router, {
    plugins: [
      new RequestCompressionHandlerPlugin(),
      new RequestLimitHandlerPlugin({ maxBodySize: 2 * 1024 * 1024 }),
      new ResponseHeadersHandlerPlugin(),
      new RateLimitHandlerPlugin(),
      new ResponseCompressionHandlerPlugin(),
      new CORSHandlerPlugin({
        allowHeaders: [
          "Content-Disposition",
          "Standard-Server",
          "Content-Type",
          "Content-Encoding",
          "Authorization",
        ],
        exposeHeaders: [
          "Content-Disposition",
          "Standard-Server",
          "Retry-After",
          "X-Request-Id",
          "RateLimit-Limit",
          "RateLimit-Remaining",
          "RateLimit-Reset",
        ],
      }),
      new EvlogHandlerPlugin({ logAbort: true }),
      new SmartCoercionHandlerPlugin({ converters: [zodConverter] }),
      new OpenAPIReferenceHandlerPlugin({
        spec: () =>
          openapiGenerator.generate(contract, {
            base: {
              info: { title: "Postplan API", version: "1.0.0" },
              servers: [{ url: "/api" }],
              components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
            },
          }),
        providerConfig: { authentication: { securitySchemes: { bearerAuth: {} } } },
      }),
    ],
  });
  function handleOpenAPIRequest(request: Request, server: Server<undefined>) {
    return onlyApplication(request, async () => {
      const { response } = await openapiHandler.handle(request, {
        prefix: "/api",
        context: context(request, server.requestIP(request)?.address ?? null, false),
      });
      return response ?? notFoundResponse();
    });
  }

  return {
    maxRequestBodySize: 2 * 1024 * 1024,
    routes: {
      "/*": (req: Request, server: Server<undefined>) =>
        index(req, server.requestIP(req)?.address ?? null),
      "/api": handleOpenAPIRequest,
      "/api/*": handleOpenAPIRequest,
      "/healthz": (req: Request) =>
        onlyApplication(req, async () => {
          if (req.method !== "GET") return notFoundResponse();
          try {
            await deps.db.get(sql`select 1`);
            return Response.json({ ok: true });
          } catch {
            return Response.json({ ok: false }, { status: 503 });
          }
        }),
    },
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  };
}

async function main(): Promise<void> {
  assertStorageConfigured();
  const { db, client } = createDatabase(config.databasePath);
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
        client.close();
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
