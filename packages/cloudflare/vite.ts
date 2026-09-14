import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { assertSqliteDatabase } from "./configuration";

export function runtimeOptions() {
  assertSqliteDatabase(process.env.POSTPLAN_DATABASE);
  return {
    plugins: [
      cloudflare({
        persistState: { path: fileURLToPath(new URL("./.wrangler/state", import.meta.url)) },
        remoteBindings: false,
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
