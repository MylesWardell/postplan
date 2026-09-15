import { defineConfig } from "vitest/config";

// Bun workspaces run this under `bun --bun vitest` so tests keep Bun globals and bun:sqlite.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Bun drops zod's `export { z }` namespace re-export when Vitest externalizes it.
    server: { deps: { inline: ["zod"] } },
  },
});
