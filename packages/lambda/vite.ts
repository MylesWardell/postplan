import { selectDatabase } from "./src/configuration";

export function runtimeOptions() {
  selectDatabase();
  return { plugins: [], entry: "../server.ts", outDir: "dist", external: ["bun:sqlite"] };
}
