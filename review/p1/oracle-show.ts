// Show examples from an oracle comparison with all three digests.
// POLICY_WASM=policy-wasm-040p bun review/p1/oracle-show.ts <compare.json> <corpus> <side> <category> [n=10]
import { readFileSync } from "node:fs";
import { validateHtml as production } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
import { digest } from "./oracle-shared";

const [file, corpus, side, category, n = "10"] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file!, "utf8"));
const examples: [string, string][] = data[corpus!][side!].examples[category!];
console.log(`${examples.length} examples`);
for (const [html, chrome] of examples.slice(0, Number(n))) {
  const p = production(html);
  const c = validateHtmlWasm(html, { walkTemplates: true, dsd: true });
  console.log(JSON.stringify(html.length > 300 ? html.slice(0, 300) + "…" : html));
  console.log("  prod", digest({ ...p, hosts: p.stats.externalImageHosts }));
  console.log("  cand", digest({ ...c, hosts: c.stats.externalImageHosts }));
  console.log("  chrm", chrome);
}
