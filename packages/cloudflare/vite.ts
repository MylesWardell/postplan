import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";

export function runtimeOptions() {
  return {
    plugins: [
      cloudflare({
        configPath:
          process.env.POSTPLAN_CLOUDFLARE_CONFIG ||
          fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        viteEnvironment: { name: "ssr" },
      }),
    ],
    entry: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    external: [],
  };
}
