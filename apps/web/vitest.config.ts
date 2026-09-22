import { defaultServerConditions } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";

import base from "../../scripts/testing/vitest.config.ts";

const store = process.env.POSTPLAN_TEST_STORE || "drizzle";
if (store !== "drizzle" && store !== "dynamodb") {
  throw new Error(`Unsupported POSTPLAN_TEST_STORE: ${store}`);
}

export default mergeConfig(
  base,
  defineConfig({
    // Resolve package.json "imports" aliases to src/*.ts, like the Vite build does.
    ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
    test: { setupFiles: [`../../scripts/testing/${store}.ts`] },
  }),
);
