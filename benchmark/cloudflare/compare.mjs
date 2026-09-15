// Prints application CPU per request for one or more result tags.
// Usage: node compare.mjs <tag> [tag...]
//
// Excludes native SQLite execution (it stands in for remote D1, which is not Worker CPU) and
// the benchmark's own request construction. Figures come from the first profiled batch.
import { readFileSync } from "node:fs";

const excludedNative = new Set(["exec", "toArray", "one", "raw", "transactionSync"]);

const rows = {};
for (const tag of process.argv.slice(2)) {
  const summary = JSON.parse(
    readFileSync(new URL(`./results/${tag}/summary.json`, import.meta.url)),
  );
  const benchFrames = new Set(Object.keys(summary));
  for (const [name, { n }] of Object.entries(summary)) {
    const profile = JSON.parse(
      readFileSync(new URL(`./results/${tag}/${name}.cpuprofile`, import.meta.url)),
    );
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map();
    for (const node of profile.nodes) {
      for (const child of node.children || []) {
        parents.set(child, node.id);
      }
    }
    const memo = new Map();
    const excluded = (id) => {
      if (memo.has(id)) {
        return memo.get(id);
      }
      const frame = nodes.get(id).callFrame;
      let result =
        (frame.url === "" && excludedNative.has(frame.functionName)) ||
        (benchFrames.has(frame.functionName) && frame.url.endsWith("index.js"));
      if (!result && parents.has(id)) {
        result = excluded(parents.get(id));
      }
      memo.set(id, result);
      return result;
    };
    let app = 0;
    profile.samples.forEach((id, index) => {
      const fn = nodes.get(id).callFrame.functionName;
      if (fn !== "(idle)" && fn !== "(program)" && !excluded(id)) {
        app += profile.timeDeltas[index];
      }
    });
    (rows[name] ??= {})[tag] = (app / 1000 / n).toFixed(2);
  }
}
console.table(rows);
