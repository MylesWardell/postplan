import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.some((arg) => !["--local", "--remote"].includes(arg)) || args.length > 1) {
  throw new Error("Use cf:initialize --local or --remote.");
}
const target = args[0] || "--local";
if (target === "--remote" && !process.env.POSTPLAN_CLOUDFLARE_CONFIG) {
  throw new Error("Remote initialization requires POSTPLAN_CLOUDFLARE_CONFIG.");
}
const config = process.env.POSTPLAN_CLOUDFLARE_CONFIG || "wrangler.jsonc";
const root = fileURLToPath(new URL("../", import.meta.url));
async function wrangler(args: string[]) {
  const child = spawnSync(
    process.execPath,
    [
      "x",
      "--no-install",
      "wrangler",
      ...args,
      "--config",
      config,
      target,
      ...(target === "--local" ? ["--persist-to", ".wrangler/state"] : []),
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (child.status !== 0) {
    throw new Error("D1 initialization failed.");
  }
}
await wrangler(["d1", "migrations", "apply", "POSTPLAN_DB"]);
await wrangler(["d1", "execute", "POSTPLAN_DB", "--file", "deploy/schema.sql", "--yes"]);
const seed = (account: string, id: string, name: string, token: string) => {
  const hash = createHash("sha256").update(token).digest("hex");
  return `INSERT OR IGNORE INTO accounts(id,name) VALUES ('${account}','${name}');
    INSERT OR IGNORE INTO api_keys(id,account_id,name,key_hash) VALUES ('${id}','${account}','${name}','${hash}');`;
};
let sql = seed(
  "acct_public_upload",
  "key_public_upload",
  "Public Uploads",
  "postplan-public-upload-sentinel",
);
if (process.env.POSTPLAN_BOOTSTRAP_API_KEY) {
  sql += seed(
    "acct_bootstrap",
    "key_bootstrap",
    "Bootstrap Account",
    process.env.POSTPLAN_BOOTSTRAP_API_KEY,
  );
}
await mkdir(new URL("../generated/", import.meta.url), { recursive: true });
await writeFile(new URL("../generated/bootstrap.sql", import.meta.url), sql);
await wrangler(["d1", "execute", "POSTPLAN_DB", "--file", "generated/bootstrap.sql", "--yes"]);
console.log("Schema and initial accounts ready; existing keys, budgets and stop latch preserved.");
