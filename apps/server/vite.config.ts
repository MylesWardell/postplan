import { defineConfig } from "vite";
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
  ssr: { external: ["bun:sqlite"] },
});
