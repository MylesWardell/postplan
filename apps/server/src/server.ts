import { serve } from "bun";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { maxBodyBytes } from "./http/body.js";
import { createDatabase, seedAccounts } from "@postplan/database";
import { assertStorageConfigured, getHtmlObject, putHtmlObject } from "./storage/s3.js";

const { db, pool } = createDatabase(config);
async function main(): Promise<void> {
  assertStorageConfigured();
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
main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
