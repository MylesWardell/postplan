import fs from "node:fs";
import type { PoolConfig } from "pg";

export interface DatabaseConfig {
  databaseUrl: string | undefined;
  databaseSslCaFile: string | undefined;
}

export function databasePoolConfig(config: DatabaseConfig): PoolConfig {
  const connectionString = config.databaseUrl;
  if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");
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
