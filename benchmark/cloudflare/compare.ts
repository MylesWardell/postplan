// Prints median application CPU per request for one or more result tags.
// Usage: bun compare.ts <tag> [tag...]
//
// Every batch excludes native SQLite execution (it stands in for remote D1, which is not
// Worker CPU) and the benchmark's request construction before the median is calculated.
import { readFileSync, writeFileSync } from "node:fs";

import { applicationMilliseconds, median, parseCpuProfile } from "./cpu-profile";

type BatchSummary = { batch: number; profile: string };
type ScenarioSummary = { n: number; batches: BatchSummary[] };
type Summary = Record<string, ScenarioSummary>;
type Comparison = Record<
  string,
  { n: number; batchAppMsPerRequest: number[]; medianAppMsPerRequest: number }
>;

const tags = process.argv.slice(2);
if (tags.length === 0) {
  throw new Error("Usage: bun compare.ts <tag> [tag...]");
}

const rows: Record<string, Record<string, string>> = {};
for (const tag of tags) {
  const output = resultUrl(tag);
  const summary = JSON.parse(readFileSync(new URL("summary.json", output), "utf8")) as Summary;
  const benchmarkFrames = new Set(Object.keys(summary));
  const comparison: Comparison = {};
  for (const [name, scenario] of Object.entries(summary)) {
    if (scenario.batches.length === 0) {
      throw new Error(`${tag}/${name} has no profiled batches.`);
    }
    const values = scenario.batches.map(({ profile: filename }) => {
      const profile = parseCpuProfile(readFileSync(new URL(filename, output), "utf8"));
      return applicationMilliseconds(profile, benchmarkFrames) / scenario.n;
    });
    const value = median(values);
    comparison[name] = {
      n: scenario.n,
      batchAppMsPerRequest: values,
      medianAppMsPerRequest: value,
    };
    (rows[name] ??= {})[tag] = value.toFixed(2);
  }
  writeFileSync(
    new URL("comparison.json", output),
    JSON.stringify(
      {
        schemaVersion: 1,
        exclusions: {
          native: ["exec", "toArray", "one", "raw", "transactionSync"],
          benchmarkRequestFactories: [...benchmarkFrames],
        },
        scenarios: comparison,
      },
      null,
      2,
    ) + "\n",
  );
}
console.table(rows);

function resultUrl(tag: string): URL {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) {
    throw new Error(`Unsafe result tag: ${tag}`);
  }
  return new URL(`./results/${tag}/`, import.meta.url);
}
