import type { Server } from "node:http";
import { createApp } from "./api.js";
import { config } from "./config.js";
import { ensureBootstrapApiKey, initDb, pool } from "./db.js";
import { assertStorageConfigured } from "./storage.js";

// How long to let in-flight requests finish after SIGTERM before forcing exit.
// Keep below the orchestrator's stop timeout (ECS stopTimeout defaults to 30s).
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 20_000);

async function main(): Promise<void> {
  assertStorageConfigured();
  await initDb();
  await ensureBootstrapApiKey();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Postplan listening on port ${config.port}`);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => shutdown(server, signal));
  }
}

// Rolling deploys (ECS, Railway) send SIGTERM and deregister the task from the
// load balancer; stop accepting connections, drain, then close the pool.
function shutdown(server: Server, signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  const force = setTimeout(() => {
    console.error("Graceful shutdown timed out; exiting.");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();

  server.close(() => {
    pool
      .end()
      .catch((error: unknown) => console.error(error))
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
