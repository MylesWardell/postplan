import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import { defaultClientConditions, defaultServerConditions } from "vite";

import { assertSqliteDatabase } from "../../packages/cloudflare/src/configuration";
import { selectDatabase } from "../../packages/lambda/src/configuration";

const target = process.env.POSTPLAN_RUNTIME || "aws";
if (target !== "aws" && target !== "cloudflare") {
  throw new Error(`Unsupported POSTPLAN_RUNTIME: ${target}`);
}

const cloudflare = target === "cloudflare";
if (cloudflare) {
  assertSqliteDatabase(process.env.POSTPLAN_DATABASE);
} else {
  selectDatabase();
}

export default defineConfig({
  output: "server",
  outDir: cloudflare ? "../../packages/cloudflare/dist" : "./dist",
  build: { serverEntry: "server.js" },
  session: false,
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  // Cookie-backed forms enforce the application origin; bearer APIs allow cross-origin clients.
  security: { checkOrigin: false },
  adapter: cloudflare
    ? (await import("@astrojs/cloudflare")).default({
        configPath: relative(
          fileURLToPath(new URL(".", import.meta.url)),
          resolve(
            fileURLToPath(new URL("../../packages/cloudflare/", import.meta.url)),
            process.env.POSTPLAN_CLOUDFLARE_CONFIG || "wrangler.jsonc",
          ),
        ).replaceAll("\\", "/"),
        persistState: {
          path: fileURLToPath(
            new URL("../../packages/cloudflare/.wrangler/state", import.meta.url),
          ),
        },
        remoteBindings: false,
        imageService: "compile",
        prerenderEnvironment: "node",
      })
    : {
        name: "postplan-bun",
        hooks: {
          "astro:config:done": ({ setAdapter }) =>
            setAdapter({
              name: "postplan-bun",
              entrypointResolution: "auto",
              serverEntrypoint: fileURLToPath(new URL("./src/server.ts", import.meta.url)),
              supportedAstroFeatures: { serverOutput: "stable" },
            }),
        },
      },
  vite: {
    define: { "import.meta.env.POSTPLAN_BUN": JSON.stringify(!cloudflare) },
    resolve: {
      alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)) },
      conditions: ["source", ...defaultClientConditions],
    },
    ssr: {
      external: cloudflare ? [] : ["bun:sqlite"],
      resolve: { conditions: ["source", ...defaultServerConditions] },
    },
  },
});
