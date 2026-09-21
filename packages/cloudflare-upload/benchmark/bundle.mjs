import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
// Confirm the direct controls do not accidentally bundle the oRPC runtime.
for (const entry of ["bare", "worker", "orpc"]) {
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/" + entry + ".ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers", "node:*"],
    write: false,
    metafile: true,
  });
  const orpcInputs = Object.keys(result.metafile.inputs).filter((p) => p.includes("@orpc/"));
  assert.equal(orpcInputs.length > 0, entry === "orpc");
  console.log(entry, "oRPC runtime modules:", orpcInputs.length);
}
