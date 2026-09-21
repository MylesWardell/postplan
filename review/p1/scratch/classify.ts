import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
for (const cat of Object.keys(r.fuzz.examples)) {
  const ex: string[] = r.fuzz.examples[cat];
  const noSelect = ex.filter((h) => !/<select/i.test(h));
  console.log(cat, "examples", ex.length, "withoutSelect", noSelect.length);
}
