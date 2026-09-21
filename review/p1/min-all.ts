// Minimise every decision/text mismatch class and print unique minimal repros.
// POLICY_WASM=policy-wasm-036p TEMPLATES=0|1 bun review/p1/min-all.ts <json>...
import { readFileSync } from "node:fs";
import { validateHtml as prodPolicy } from "../../packages/store/src/html-policy";
import { validateHtml as templatePolicy } from "./html-policy-templates";
import { validateHtmlWasm } from "./candidate";

const walkTemplates = process.env.TEMPLATES === "1";
const prod = walkTemplates ? templatePolicy : prodPolicy;
const cand = (h: string) => validateHtmlWasm(h, { walkTemplates });

const checks: Record<string, (h: string) => boolean> = {
  unsafeAccept: (h) => cand(h).ok && !prod(h).ok,
  missedScript: (h) => prod(h).hasScripts && !cand(h).hasScripts,
  stricter: (h) => !cand(h).ok && prod(h).ok,
  extraScript: (h) => !prod(h).hasScripts && cand(h).hasScripts,
  errorsDiff: (h) => [...prod(h).errors].sort().join("\n") !== [...cand(h).errors].sort().join("\n"),
  errorOrderDiff: (h) => prod(h).errors.join("\n") !== cand(h).errors.join("\n"),
  titleDiff: (h) => prod(h).title !== cand(h).title,
};

function minimize(input: string, keep: (h: string) => boolean): string {
  let cur = input;
  for (let chunk = Math.max(1, cur.length >> 1); chunk >= 1; chunk >>= 1) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let at = 0; at < cur.length; ) {
        const next = cur.slice(0, at) + cur.slice(at + chunk);
        if (next.trim() && next.isWellFormed() && keep(next)) {
          cur = next;
          changed = true;
        } else {
          at += chunk;
        }
      }
    }
  }
  return cur;
}

const found = new Map<string, Set<string>>();
for (const file of process.argv.slice(2)) {
  const examples = JSON.parse(readFileSync(file, "utf8")).fuzz.examples;
  for (const [category, keep] of Object.entries(checks)) {
    for (const html of (examples[category] ?? []) as string[]) {
      if (!html.isWellFormed() || !keep(html)) continue;
      let set = found.get(category);
      if (!set) found.set(category, (set = new Set()));
      set.add(minimize(html, keep));
    }
  }
}
for (const [category, set] of found) {
  console.log(`== ${category} (${set.size} minimal)`);
  for (const h of [...set].toSorted((a, b) => a.length - b.length)) {
    const p = prod(h);
    const c = cand(h);
    console.log(JSON.stringify(h), "| prod", p.ok, JSON.stringify(p.errors), p.hasScripts, JSON.stringify(p.title), "| cand", c.ok, JSON.stringify(c.errors), c.hasScripts, JSON.stringify(c.title));
  }
}
