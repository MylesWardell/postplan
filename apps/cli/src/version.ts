import { createRequire } from "node:module";

// Resolved relative to the bundled bin/postplan.js, so it reads the CLI's own package.json.
export const { version: VERSION } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};
