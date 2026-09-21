import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
execFileSync("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"], {
  cwd,
  stdio: "inherit",
});
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
copyFileSync(
  new URL("../target/wasm32-unknown-unknown/release/postplan_html_validator.wasm", import.meta.url),
  new URL("../dist/policy.wasm", import.meta.url),
);
