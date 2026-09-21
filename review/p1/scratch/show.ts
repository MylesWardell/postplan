import { readFileSync } from "node:fs";
import { validateHtml } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
const [file, corpus, cat, n] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file!, "utf8"));
for (const h of r[corpus!].examples[cat!].slice(0, Number(n ?? 3))) {
  const p = validateHtml(h), c = validateHtmlWasm(h);
  console.log("----", JSON.stringify(h.length > 400 ? h.slice(0, 400) + "…" : h));
  console.log(" prod", JSON.stringify({ ok: p.ok, e: p.errors, t: p.title, s: p.hasScripts }));
  console.log(" cand", JSON.stringify({ ok: c.ok, e: c.errors, t: c.title, s: c.hasScripts }));
}
