import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)) } },
  plugins: [
    cloudflareTest({
      main: "./cloudflare/test-entry.ts",
      wrangler: { configPath: "./cloudflare/wrangler.jsonc" },
      miniflare: { bindings: { EXPERIMENT_TOKEN: "local-test-only" } },
    }),
  ],
  test: { include: ["cloudflare/test/**/*.test.ts"] },
});
