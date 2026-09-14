import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("CLI displays the oRPC error message and upload validation details", async () => {
  const directory = fs.mkdtempSync(join(tmpdir(), "postplan-cli-"));
  const file = join(directory, "invalid.html");
  fs.writeFileSync(file, "<form>" + "x".repeat(2000) + "</form>");
  let encoding: string | undefined;
  const server = createServer((req, res) => {
    encoding = req.headers["content-encoding"];
    req.resume();
    res.writeHead(422, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        defined: true,
        code: "UNPROCESSABLE_CONTENT",
        message: "HTML validation failed.",
        data: { ok: false, errors: ["Forms are not allowed."], warnings: [] },
      }),
    );
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const cli = fileURLToPath(new URL("../../bin/postplan.js", import.meta.url));
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [cli, "upload", file, "--new", "--api-url", `http://127.0.0.1:${address.port}`],
        {
          env: { ...process.env, POSTPLAN_API_KEY: "test-key" },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error && "stderr" in error && "code" in error);
        assert.equal(error.code, 1);
        assert.match(String(error.stderr), /HTML validation failed\.\s+- Forms are not allowed\./);
        return true;
      },
    );
    assert.equal(encoding, "gzip");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("compiled CLI resolves package version and exposes commands", () => {
  const cli = fileURLToPath(new URL("../../bin/postplan.js", import.meta.url));
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(),
    pkg.version,
  );
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /upload/);
  assert.match(help, /auth/);
  assert.match(help, /list/);
});
