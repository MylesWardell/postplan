import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: {
      "#config": fileURLToPath(new URL("../../apps/server/src/config.ts", import.meta.url)),
    },
  },
  plugins: [
    cloudflareTest({
      main: "./test-entry.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { EXPERIMENT_TOKEN: "local-test-only" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
