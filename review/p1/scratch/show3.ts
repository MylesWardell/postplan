import { readFileSync } from "node:fs";
import { validateHtml } from "./html-policy-templates";
import { validateHtmlWasm } from "./candidate";
const r = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
for (const h of r.fuzz.examples.errorsDiff ?? []) {
  const p = validateHtml(h), c = validateHtmlWasm(h, { walkTemplates: true });
  console.log(JSON.stringify(h).slice(0, 600)); console.log(" prod", p.ok, p.errors); console.log(" cand", c.ok, c.errors);
}
