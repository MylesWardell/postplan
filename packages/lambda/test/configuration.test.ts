import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { createDatabase } from "@postplan/store-drizzle/client";
import { migrateDatabase } from "@postplan/store-drizzle/migrate";

import { selectDatabase } from "../src/configuration";
import { createRuntimeStore } from "../src/store";

test("AWS selects exactly one database and explicit selection overrides legacy detection", () => {
  const existing = { AWS_LAMBDA_FUNCTION_NAME: "app", POSTPLAN_IDENTITY_TABLE: "identity" };
  expect(selectDatabase({ ...existing, POSTPLAN_DATABASE: "sqlite" })).toBe("sqlite");
  expect(selectDatabase({ POSTPLAN_DATABASE: "dynamodb" })).toBe("dynamodb");
  expect(selectDatabase(existing)).toBe("dynamodb");
  expect(selectDatabase({})).toBe("sqlite");
  for (const selected of ["sqlite,dynamodb", "", "postgres"]) {
    expect(() => selectDatabase({ POSTPLAN_DATABASE: selected })).toThrow("sqlite or dynamodb");
  }
});

test("an AWS Lambda process can open SQLite without initializing DynamoDB", async () => {
  const child = Bun.spawn(
    [
      "bun",
      "--conditions=source",
      "-e",
      `
      import { createRuntimeStore } from "./src/store.ts";
      const connection = createRuntimeStore({ databasePath: ":memory:", planRetentionDays: 30 });
      try { await connection.store.health(); } finally { connection.close(); }
    `,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        POSTPLAN_DATABASE: "sqlite",
        AWS_LAMBDA_FUNCTION_NAME: "test",
        POSTPLAN_IDENTITY_TABLE: "unused",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const error = await new Response(child.stderr).text();
  expect(await child.exited, error).toBe(0);
});

test("the public SQLite store close releases all cached prepared statements", async () => {
  const directory = mkdtempSync(join(tmpdir(), "postplan-store-close-"));
  const filename = join(directory, "postplan.sqlite");
  const previousDatabase = process.env.POSTPLAN_DATABASE;
  const migration = createDatabase(filename);
  try {
    migrateDatabase(migration.db);
  } finally {
    migration.client.close();
  }
  // Keep migration internals from contributing handles to the lifecycle assertion below.
  Bun.gc(true);

  process.env.POSTPLAN_DATABASE = "sqlite";
  const connection = createRuntimeStore({ databasePath: filename, planRetentionDays: 30 });
  try {
    await connection.store.initialize({ bootstrapKey: "store-close-key" });
    const apiKey = await connection.store.accounts.findApiKey({ token: "store-close-key" });
    assert(apiKey);
    const context = {
      apiKey,
      sourceIp: null,
      userAgent: null,
      requestId: null,
      maxHtmlBytes: 1024 * 1024,
      putHtml: async () => {},
      requestBaseUrl: "https://postplan.test",
    };
    const created = await connection.store.drafts.upload({
      context,
      input: { html: "<!doctype html><title>Lifecycle test</title>" },
    });
    assert(created.ok);
    const updated = await connection.store.drafts.upload({
      context,
      input: { draftId: created.draftId, html: "<!doctype html><title>Updated</title>" },
    });
    assert(updated.ok);
    await connection.store.drafts.list({
      accountId: apiKey.accountId,
      context,
      limit: 10,
      status: "all",
    });
    await connection.store.drafts.totals({ accountId: apiKey.accountId });
    await connection.store.drafts.detail({
      accountId: apiKey.accountId,
      draftId: created.draftId,
      context,
    });
    await connection.store.drafts.findPublicVersion({ draftId: created.draftId });
    await connection.store.drafts.findPublicVersion({
      draftId: created.draftId,
      versionNumber: 1,
    });

    connection.close();
    connection.close();
    // Collect transient Drizzle statements; cached statements remain strongly held unless close evicts them.
    Bun.gc(true);
    rmSync(filename);
    expect(existsSync(filename)).toBe(false);
  } finally {
    connection.close();
    if (previousDatabase === undefined) {
      delete process.env.POSTPLAN_DATABASE;
    } else {
      process.env.POSTPLAN_DATABASE = previousDatabase;
    }
    // Release Drizzle's temporary statements before removing SQLite sidecars on Windows.
    Bun.gc(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
