// Minimise a candidate-vs-Chrome unsafe accept with headless Chrome in the loop.
// Needs oracle-server.ts running on 5287.
// POLICY_WASM=policy-wasm-040p bun review/p1/oracle-minimize.ts <compare.json> <corpus> [index=0]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateHtmlWasm } from "./candidate";
import type { Digest } from "./oracle-shared";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [file, corpus, index = "0"] = process.argv.slice(2);
const start: string = JSON.parse(readFileSync(file!, "utf8"))[corpus!].candidate.examples.unsafeAccept[Number(index)][0];

const candAccepts = (h: string) => h.trim() !== "" && h.isWellFormed() && validateHtmlWasm(h, { walkTemplates: true }).ok;

function chromeRejects(cases: string[]): boolean[] {
  writeFileSync(new URL("./probe-cases.json", import.meta.url), JSON.stringify(cases));
  const profile = mkdtempSync(join(tmpdir(), "p1-min-"));
  const out = Bun.spawnSync([
    CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--dump-dom", "http://127.0.0.1:5287/judge",
  ]).stdout.toString();
  rmSync(profile, { recursive: true, force: true });
  const match = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error(`judge failed: ${out.slice(0, 300)}`);
  const text = match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  return (JSON.parse(text) as string[]).map((d) => !(JSON.parse(d) as Digest)[0]);
}

if (!candAccepts(start) || !chromeRejects([start])[0]) throw new Error("start case does not reproduce");
let cur = start;
for (let chunk = Math.max(1, cur.length >> 1); chunk >= 1; chunk >>= 1) {
  for (let changed = true; changed; ) {
    changed = false;
    const options: string[] = [];
    for (let at = 0; at < cur.length; at += chunk) {
      const next = cur.slice(0, at) + cur.slice(at + chunk);
      if (candAccepts(next)) options.push(next);
    }
    for (let i = 0; i < options.length; i += 400) {
      const batch = options.slice(i, i + 400);
      const hit = chromeRejects(batch).findIndex(Boolean);
      if (hit >= 0) {
        cur = batch[hit]!;
        changed = true;
        break;
      }
    }
  }
  console.log(chunk, JSON.stringify(cur));
}
console.log("minimal", JSON.stringify(cur));
