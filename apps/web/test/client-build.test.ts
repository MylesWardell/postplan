import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

test("Astro ships styles without a JavaScript hydration bundle", () => {
  const directory = fileURLToPath(new URL("../dist/client/", import.meta.url));
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })];
  assert.ok(files.some((file) => file.replaceAll("\\", "/") === "assets/styles.css"));
  assert.deepEqual(
    files.filter((file) => /\.(?:m?js|map)$/.test(file)),
    [],
  );
});
