import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagePath = path.relative(root, process.cwd()).split(path.sep);
if (packagePath.length !== 2 || !["apps", "packages"].includes(packagePath[0] ?? "")) {
  throw new Error("Run package builds from a workspace package directory.");
}
// The checked package directory and literal output name bound this deletion.
rmSync(path.resolve(process.cwd(), "dist"), { recursive: true, force: true });
