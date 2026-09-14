import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const target = process.env.POSTPLAN_RUNTIME || "aws";
if (target !== "aws" && target !== "cloudflare") {
  throw new Error(`Unsupported POSTPLAN_RUNTIME: ${target}`);
}
const runtime =
  target === "cloudflare"
    ? (await import("../../packages/cloudflare/vite.ts")).runtimeOptions()
    : (await import("../../packages/lambda/vite.ts")).runtimeOptions();

export default defineConfig({
  plugins: [
    ...runtime.plugins,
    tanstackStart({
      srcDirectory: "src/frontend",
      router: { quoteStyle: "double", semicolons: true },
      server: { entry: runtime.entry },
    }),
    react(),
  ],
  // Bundle package.json "imports" aliases from src rather than tsc's dist output.
  build: { outDir: runtime.outDir, emptyOutDir: true },
  resolve: {
    alias: { "#config": fileURLToPath(new URL("./src/config.ts", import.meta.url)) },
    conditions: ["source", ...defaultClientConditions],
  },
  ssr: {
    external: runtime.external,
    resolve: { conditions: ["source", ...defaultServerConditions] },
  },
});
