import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
