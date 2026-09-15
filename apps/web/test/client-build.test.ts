import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

test("Start splits pages and excludes database, storage, and session implementation from client assets", async () => {
  const directory = fileURLToPath(new URL("../dist/client/", import.meta.url));
  const files = [...new Bun.Glob("**/*.js").scanSync({ cwd: directory })];
  assert.ok(files.some((file) => /dashboard-[\w-]+\.js$/.test(file)));
  assert.ok(files.some((file) => /_draftId-[\w-]+\.js$/.test(file)));
  for (const file of files) {
    const source = await Bun.file(`${directory}/${file}`).text();
    assert.doesNotMatch(
      source,
      /bun:sqlite|drizzle-orm|@aws-sdk|SESSION_SECRET|S3_SECRET_ACCESS_KEY|createContextFactory/,
      file,
    );
  }
});
