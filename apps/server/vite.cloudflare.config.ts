import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({
      configPath: process.env.POSTPLAN_CLOUDFLARE_CONFIG || "cloudflare/wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
    }),
    tanstackStart({
      srcDirectory: "src/frontend",
      router: { quoteStyle: "double", semicolons: true },
      server: { entry: "../../cloudflare/worker.ts" },
    }),
    react(),
  ],
  build: { outDir: "cloudflare/dist" },
  resolve: {
    alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)) },
    conditions: ["source", ...defaultClientConditions],
  },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
});
