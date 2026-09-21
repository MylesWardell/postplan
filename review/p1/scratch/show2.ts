import { readFileSync } from "node:fs";
import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
const r = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
for (const cat of ["errorsDiff", "titleDiff"]) for (const h of (r.fuzz.examples[cat] ?? []).filter((h: string) => !/<select/i.test(h))) {
  const p = validateHtml(h), c = validateHtmlWasm(h);
  console.log("----", cat, JSON.stringify(h));
  console.log(" prod", JSON.stringify({ ok: p.ok, e: p.errors, t: p.title }));
  console.log(" cand", JSON.stringify({ ok: c.ok, e: c.errors, t: c.title }));
}
