import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { selectDatabase } from "../src/configuration";

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
