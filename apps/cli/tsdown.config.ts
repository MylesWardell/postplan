import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { postplan: "src/index.ts" },
  outDir: "bin",
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  deps: { alwaysBundle: [/^@postplan\//] },
});
