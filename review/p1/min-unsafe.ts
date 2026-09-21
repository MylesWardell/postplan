// Minimise only the security-relevant mismatch classes and print unique repros.
// POLICY_WASM=policy-wasm-040p TEMPLATES=1 bun review/p1/min-unsafe.ts <json>...
import { readFileSync } from "node:fs";
import { validateHtml as prodPolicy } from "../../packages/store/src/html-policy";
import { validateHtml as templatePolicy } from "./html-policy-templates";
import { validateHtmlWasm } from "./candidate";

const walkTemplates = process.env.TEMPLATES === "1";
const prod = walkTemplates ? templatePolicy : prodPolicy;
const cand = (h: string) => validateHtmlWasm(h, { walkTemplates, dsd: true });

const all: Record<string, (h: string) => boolean> = {
  unsafeAccept: (h) => cand(h).ok && !prod(h).ok,
  missedScript: (h) => prod(h).hasScripts && !cand(h).hasScripts,
  hostsDiff: (h) =>
    prod(h).stats.externalImageHosts.join(",") !== cand(h).stats.externalImageHosts.join(","),
  titleDiff: (h) => prod(h).title !== cand(h).title,
};
const only = (process.env.CATS ?? "unsafeAccept,missedScript").split(",");
const checks = Object.fromEntries(Object.entries(all).filter(([k]) => only.includes(k)));

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
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const corpus of ["wpt", "targeted", "fuzz"]) {
    for (const [category, keep] of Object.entries(checks)) {
      for (const html of (data[corpus].examples[category] ?? []) as string[]) {
        if (!html.isWellFormed() || !keep(html)) continue;
        let set = found.get(category);
        if (!set) found.set(category, (set = new Set()));
        set.add(minimize(html, keep));
      }
    }
  }
}
for (const [category, set] of found) {
  console.log(`== ${category} (${set.size} minimal)`);
  for (const h of [...set].toSorted((a, b) => a.length - b.length)) {
    const p = prod(h);
    const c = cand(h);
    console.log(
      JSON.stringify(h),
      "| prod", p.ok, JSON.stringify(p.errors), p.hasScripts,
      "| cand", c.ok, JSON.stringify(c.errors), c.hasScripts,
    );
  }
}
