// Print a sample of one mismatch category as JSON, for adjudicating in Chrome.
// POLICY_WASM=policy-wasm-040p TEMPLATES=1 bun review/p1/sample.ts <json> <corpus> <category> [count]
import { readFileSync } from "node:fs";

const [file, corpus, category, count = "12"] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file!, "utf8"));
const examples: string[] = data[corpus!].examples[category!] ?? [];
const sample = examples.filter((h) => h.isWellFormed()).slice(0, Number(count));
console.log(JSON.stringify(sample));
