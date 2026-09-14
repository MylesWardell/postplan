import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    tanstackStart({
      srcDirectory: "src/frontend",
      router: { quoteStyle: "double", semicolons: true, addExtensions: ".js" },
      server: { entry: "../server.ts" },
    }),
    react(),
  ],
  // Bundle package.json "imports" aliases from src rather than tsc's dist output.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: {
    external: ["bun:sqlite"],
    resolve: { conditions: ["source", ...defaultServerConditions] },
  },
});
