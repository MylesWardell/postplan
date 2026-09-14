import { shutdownInstrumentation } from "./instrumentation";
import { serve } from "bun";
import type { Server } from "bun";
import { fileURLToPath } from "node:url";
import { createRuntimeDatabase } from "#db/client";
import { isDynamoDatabase } from "#db/dynamo";
import { gatewayRequest } from "#lib/gateway";
import { seedAccounts } from "#routers/account-store";
import { config } from "./config";
import type { ServerDependencies } from "./context";
import type { createApplication } from "./server";
import { onlyApplication } from "#lib/host-guard";
import { notFoundResponse } from "#frontend/response.server";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "#lib/s3";

export function createServerOptions(
  deps: ServerDependencies,
  start: { createApplication: typeof createApplication },
  clientDirectory = new URL("../client/", import.meta.url),
) {
  const application = start.createApplication(deps);
  const assets = new Map<string, ReturnType<typeof Bun.file>>();
  const directory = fileURLToPath(clientDirectory);
  for (const file of new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })) {
    assets.set("/" + file.replaceAll("\\", "/"), Bun.file(directory + "/" + file));
  }
  return {
    maxRequestBodySize: 2 * 1024 * 1024,
    fetch: (incoming: Request, server: Server<undefined>) => {
      let request = incoming;
      let peerIp = server.requestIP(incoming)?.address ?? null;
      if (config.apiGateway) {
        // Adapter readiness requests have no invocation context.
        if (
          new URL(incoming.url).pathname === "/healthz" &&
          !incoming.headers.has("x-amzn-request-context") &&
          peerIp &&
          ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peerIp)
        ) {
          return Response.json({ ok: true });
        }
        try {
          ({ request, peerIp } = gatewayRequest(incoming));
        } catch {
          return new Response("Invalid gateway request", { status: 400 });
        }
      }
      const pathname = new URL(request.url).pathname;
      const asset = assets.get(pathname);
      if (asset) {
        return onlyApplication(request, () =>
          request.method === "GET" || request.method === "HEAD"
            ? new Response(request.method === "HEAD" ? null : asset, {
                headers: {
                  "Content-Type": asset.type,
                  "Cache-Control": /-[\w-]{8,}\.(js|css)$/.test(pathname)
                    ? "public, max-age=31536000, immutable"
                    : "no-cache",
                },
              })
            : notFoundResponse(),
        );
      }
      return application(request, peerIp);
    },
  };
}

export async function main(): Promise<void> {
  assertStorageConfigured();
  const { db, close } = createRuntimeDatabase();
  if (isDynamoDatabase(db)) {
    await db.health();
  }
  if (!isDynamoDatabase(db)) {
    await seedAccounts(db, config.bootstrapApiKey);
  }
  const entry = new URL("../server/server.js", import.meta.url).href;
  const start: { createApplication: typeof createApplication } = await import(entry);
  const server = serve({
    port: config.port,
    ...createServerOptions({ db, putHtml: putHtmlObject, getHtml: getHtmlObject }, start),
  });
  console.log(`Postplan listening at ${server.url}`);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      if (stopping) {
        return;
      }
      stopping = true;
      const force = setTimeout(
        () => process.exit(1),
        Number(process.env.SHUTDOWN_GRACE_MS || 20_000),
      );
      force.unref();
      try {
        await server.stop();
        close();
        await shutdownInstrumentation();
        process.exit(0);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    });
  }
}
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
