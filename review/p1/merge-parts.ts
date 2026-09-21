// Concatenate the sliced oracle results for one seed into the file the
// comparison expects, whatever slice boundaries were used.
// bun review/p1/merge-parts.ts <seed> <count>
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const [seed, count] = process.argv.slice(2).map(Number);
const here = new URL("./", import.meta.url);
const prefix = `oracle-chrome-fuzz-${seed}-p`;
const offsets = readdirSync(here)
  .filter((file) => file.startsWith(prefix))
  .map((file) => Number(file.slice(prefix.length, -5)))
  .toSorted((a, b) => a - b);

const results: unknown[] = [];
for (const offset of offsets) {
  if (offset !== results.length) throw new Error(`seed ${seed}: slice at ${offset} follows ${results.length}`);
  results.push(...(JSON.parse(readFileSync(new URL(`${prefix}${offset}.json`, here), "utf8")) as unknown[]));
}
if (results.length !== count) throw new Error(`seed ${seed}: ${results.length} results, expected ${count}`);

writeFileSync(new URL(`oracle-chrome-fuzz-${seed}.json`, here), JSON.stringify(results));
for (const offset of offsets) rmSync(new URL(`${prefix}${offset}.json`, here));
console.log(`merged fuzz-${seed}: ${results.length} results from ${offsets.length} slices`);
