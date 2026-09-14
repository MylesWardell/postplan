import fs from "node:fs";
import type { PoolConfig } from "pg";
import { requireEnv } from "./config.js";
import type { Config } from "./config.js";

export function databasePoolConfig(
  config: Pick<Config, "databaseUrl" | "databaseSslCaFile">,
): PoolConfig {
  const connectionString = requireEnv("DATABASE_URL", config.databaseUrl);
  if (!config.databaseSslCaFile) return { connectionString };

  // pg replaces the explicit SSL object when URL SSL options are present.
  const params = new URL(connectionString).searchParams;
  if (["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"].some((key) => params.has(key))) {
    throw new Error("Remove SSL URL parameters when DATABASE_SSL_CA_FILE is set.");
  }
  return {
    connectionString,
    ssl: { ca: fs.readFileSync(config.databaseSslCaFile, "utf8"), rejectUnauthorized: true },
  };
}
