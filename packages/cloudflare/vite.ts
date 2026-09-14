import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { assertSqliteDatabase } from "./src/configuration";

export function runtimeOptions() {
  assertSqliteDatabase(process.env.POSTPLAN_DATABASE);
  return {
    plugins: [
      cloudflare({
        persistState: { path: fileURLToPath(new URL("./.wrangler/state", import.meta.url)) },
        remoteBindings: false,
        configPath: resolve(
          fileURLToPath(new URL("./", import.meta.url)),
          process.env.POSTPLAN_CLOUDFLARE_CONFIG || "wrangler.jsonc",
        ),
        viteEnvironment: { name: "ssr" },
      }),
    ],
    entry: fileURLToPath(new URL("./src/worker.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    external: [],
  };
}
