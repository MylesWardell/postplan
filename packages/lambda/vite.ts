export function runtimeOptions() {
  return { plugins: [], entry: "../server.ts", outDir: "dist", external: ["bun:sqlite"] };
}
