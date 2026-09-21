// Minimise unsafe mismatches (candidate accepts a production-rejected input,
// or misses a script production found). Usage:
// POLICY_WASM=policy-wasm-036 bun review/p1/minimize.ts <differential.json>
import { readFileSync } from "node:fs";
import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";

const unsafe = (html: string) => {
  if (!html.trim()) return false;
  const p = validateHtml(html);
  const c = validateHtmlWasm(html);
  return (c.ok && !p.ok) || (p.hasScripts && !c.hasScripts);
};

function minimize(input: string): string {
  let current = input;
  for (let chunk = Math.max(1, current.length >> 1); chunk >= 1; chunk >>= 1) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let at = 0; at < current.length; ) {
        const next = current.slice(0, at) + current.slice(at + chunk);
        if (unsafe(next)) {
          current = next;
          changed = true;
        } else {
          at += chunk;
        }
      }
    }
  }
  return current;
}

const r = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const inputs = new Set<string>([...(r.fuzz.examples.unsafeAccept ?? []), ...(r.fuzz.examples.missedScript ?? [])]);
const minimal = new Set<string>();
for (const html of inputs) minimal.add(minimize(html));
for (const html of [...minimal].toSorted((a, b) => a.length - b.length)) {
  const p = validateHtml(html);
  const c = validateHtmlWasm(html);
  console.log(JSON.stringify(html), "| prod", p.ok, p.errors, p.hasScripts, "| cand", c.ok, c.errors, c.hasScripts);
}
