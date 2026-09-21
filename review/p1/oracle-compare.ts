// Compare production (parse5) and the WASM candidate against Chrome digests.
// POLICY_WASM=policy-wasm-040p bun review/p1/oracle-compare.ts [seeds=1] [count=200000]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateHtml as production } from "../../packages/store/src/html-policy";
import { validateHtmlWasm } from "./candidate";
import { digest, fuzzCorpus, targeted, type Digest } from "./oracle-shared";

const seeds = (process.argv[2] ?? "1").split(",").map(Number);
const count = Number(process.argv[3] ?? 200000);

function wptInputs(): string[] {
  const dir = new URL("./wpt/html/syntax/parsing/resources/", import.meta.url);
  const inputs: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".dat")).toSorted()) {
    const text = readFileSync(new URL(file, dir), "utf8");
    for (const block of text.split(/\n(?=#data\n)/)) {
      if (!block.startsWith("#data\n")) continue;
      const end = block.indexOf("\n#errors");
      inputs.push(block.slice(6, end));
    }
  }
  return inputs;
}

// Production is judged against Chrome without <template> contents (plain
// templates are inert), the candidate against Chrome with them walked.
const sides = {
  production: (html: string) => {
    const r = production(html);
    return digest({ ...r, hosts: r.stats.externalImageHosts });
  },
  candidate: (html: string) => {
    const r = validateHtmlWasm(html, { walkTemplates: true, dsd: true });
    return digest({ ...r, hosts: r.stats.externalImageHosts });
  },
};

const CATEGORIES = [
  "unsafeAccept",
  "missedScript",
  "missedHost",
  "stricter",
  "extraScript",
  "errorsDiff",
  "titleDiff",
  "deepDiff",
] as const;
type Category = (typeof CATEGORIES)[number];

function classify(side: Digest, chrome: Digest): Category[] {
  const [ok, scripts, hosts, errors, title, deep] = side;
  const [cOk, cScripts, cHosts, cErrors, cTitle, cDeep] = chrome;
  const out: Category[] = [];
  // A document rejected by the depth rule is never served, so only a side that
  // really accepts (including depth) can under-report.
  const accepts = ok && !deep;
  if (accepts && !cOk) out.push("unsafeAccept");
  if (accepts && cScripts && !scripts) out.push("missedScript");
  if (accepts && cHosts.some((h) => !hosts.includes(h))) out.push("missedHost");
  if (!ok && cOk) out.push("stricter");
  if (scripts && !cScripts) out.push("extraScript");
  // The DOM names namespaced SVG xlink:href by its qualified name; parse5 and
  // html5ever report the local name. Both are URL attributes, so only the
  // message differs.
  const norm = (list: string[]) =>
    [...new Set(list.map((e) => e.replace('"xlink:href"', '"href"')))].toSorted().join("\n");
  if (norm(errors) !== norm(cErrors)) out.push("errorsDiff");
  if (title !== cTitle) out.push("titleDiff");
  if (deep !== cDeep) out.push("deepDiff");
  return out;
}

function report(name: string, inputs: string[]) {
  const chromeBoth: [string, string][] = JSON.parse(readFileSync(new URL(`./oracle-chrome-${name}.json`, import.meta.url), "utf8"));
  if (chromeBoth.length !== inputs.length) throw new Error(`${name}: ${chromeBoth.length} Chrome results for ${inputs.length} inputs`);
  const result: Record<string, { counts: Record<string, number>; examples: Record<string, [string, string][]> }> = {};
  for (const [sideName, run] of Object.entries(sides)) {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
    const examples = Object.fromEntries(CATEGORIES.map((c) => [c, [] as [string, string][]])) as Record<Category, [string, string][]>;
    let threw = 0;
    let empty = 0;
    inputs.forEach((html, i) => {
      const chrome = chromeBoth[i]![sideName === "candidate" ? 0 : 1];
      if (chrome.startsWith("threw:")) {
        threw++;
        return;
      }
      // Empty documents are rejected before parsing; the oracle has no such rule.
      if (html.trim() === "") {
        empty++;
        return;
      }
      for (const category of classify(JSON.parse(run(html)), JSON.parse(chrome))) {
        counts[category]++;
        if (examples[category].length < 200) examples[category].push([html, chrome]);
      }
    });
    console.log(name.padEnd(9), sideName.padEnd(10), JSON.stringify({ inputs: inputs.length, empty, chromeThrew: threw, ...counts }));
    result[sideName] = { counts, examples };
  }
  return result;
}

const wpt = wptInputs();
const results: Record<string, unknown> = {
  wpt: report("wpt", wpt),
  targeted: report("targeted", targeted.filter((h) => h.trim())),
};
for (const seed of seeds) results[`fuzz-${seed}`] = report(`fuzz-${seed}`, fuzzCorpus(seed, count, wpt));
writeFileSync(
  new URL(`./oracle-compare-${process.env.POLICY_WASM ?? "policy-wasm"}-${seeds.join("_")}-${count}.json`, import.meta.url),
  JSON.stringify(results),
);
