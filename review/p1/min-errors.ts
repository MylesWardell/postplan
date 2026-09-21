import { readFileSync } from "node:fs";
import { validateHtml } from "./html-policy-templates";
import { validateHtmlWasm } from "./candidate";
const diff = (h: string) => { if (!h.trim()) return false; const p = validateHtml(h), c = validateHtmlWasm(h, { walkTemplates: true });
  return [...p.errors].sort().join() !== [...c.errors].sort().join() || p.ok !== c.ok || p.hasScripts !== c.hasScripts; };
let cur: string = JSON.parse(readFileSync(process.argv[2]!, "utf8")).fuzz.examples.errorsDiff[0];
for (let chunk = cur.length >> 1; chunk >= 1; chunk >>= 1) { let changed = true; while (changed) { changed = false;
  for (let at = 0; at < cur.length;) { const n = cur.slice(0, at) + cur.slice(at + chunk); if (diff(n)) { cur = n; changed = true; } else at += chunk; } } }
const p = validateHtml(cur), c = validateHtmlWasm(cur, { walkTemplates: true });
console.log(JSON.stringify(cur), p.errors, c.errors);
