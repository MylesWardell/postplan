import assert from "node:assert/strict";
import { test } from "bun:test";
import { databasePoolConfig } from "../../src/db/config.js";

test("rejects URL options that would replace certificate verification", () => {
  for (const option of [
    "sslmode=disable",
    "sslmode=require",
    "sslcert=x",
    "sslkey=x",
    "sslrootcert=x",
    "ssl=false",
  ]) {
    assert.throws(
      () =>
        databasePoolConfig({
          databaseUrl: `postgresql://localhost/postplan?${option}`,
          databaseSslCaFile: "unused.pem",
        }),
      /Remove SSL URL parameters/,
    );
  }
});

test("preserves local database connection settings without a CA override", () => {
  assert.deepEqual(
    databasePoolConfig({
      databaseUrl: "postgresql://localhost/postplan",
      databaseSslCaFile: undefined,
    }),
    {
      connectionString: "postgresql://localhost/postplan",
    },
  );
});
