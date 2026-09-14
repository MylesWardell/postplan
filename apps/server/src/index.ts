import { shutdownInstrumentation } from "./instrumentation.js";
import { serve } from "bun";
import type { Server } from "bun";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db/client.js";
import { seedAccounts } from "./routers/account-store.js";
import { config } from "./config.js";
import type { ServerDependencies } from "./http/context.js";
import type { createApplication } from "./server.js";
import { onlyApplication } from "./http/response.js";
import { notFoundResponse } from "./frontend/response.server.js";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";

export function createServerOptions(
  deps: ServerDependencies,
  start: { createApplication: typeof createApplication },
  clientDirectory = new URL("../client/", import.meta.url),
) {
  const application = start.createApplication(deps);
  const assets = new Map<string, ReturnType<typeof Bun.file>>();
  const directory = fileURLToPath(clientDirectory);
  for (const file of new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true }))
    assets.set("/" + file.replaceAll("\\", "/"), Bun.file(directory + "/" + file));
  return {
    maxRequestBodySize: 2 * 1024 * 1024,
    fetch: (request: Request, server: Server<undefined>) => {
      const pathname = new URL(request.url).pathname;
      const asset = assets.get(pathname);
      if (asset)
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
      return application(request, server.requestIP(request)?.address ?? null);
    },
  };
}

async function main(): Promise<void> {
  assertStorageConfigured();
  const { db, client } = createDatabase(config.databasePath);
  await seedAccounts(db, config.bootstrapApiKey);
  const entry = new URL("../server/server.js", import.meta.url).href;
  const start: { createApplication: typeof createApplication } = await import(entry);
  const server = serve({
    port: config.port,
    ...createServerOptions({ db, putHtml: putHtmlObject, getHtml: getHtmlObject }, start),
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
