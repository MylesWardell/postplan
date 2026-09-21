import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
// Run only against explicitly configured disposable test accounts. Tokens stay in config.
const [configPath, outputPath] = process.argv.slice(2);
assert.ok(
  configPath && outputPath,
  "Usage: node packages/cloudflare-upload/benchmark/run.mjs ignored-config.json ignored-results.json",
);
const arms = JSON.parse(readFileSync(configPath, "utf8"));
assert.equal(arms.length, 3, "Configure bare, hono, orpc in that order");
export function fixture(size, dense = false) {
  const head = "<!doctype html><title>Validator bounded test</title><body>";
  const piece = dense
    ? '<section><table><tr><td>x</td></tr></table><svg><path d="M0 0L10 10"/></svg><img src="https://img.test/a"></section>'
    : "<p>Synthetic review paragraph for bounded CPU testing.</p>";
  const body = head + piece.repeat(Math.floor((size - head.length - 7) / piece.length));
  return body + " ".repeat(size - body.length - 7) + "</body>";
}
const records = [];
for (let round = 0; round < 6; round++) {
  const order = [...arms.slice(round % 3), ...arms.slice(0, round % 3)];
  if (round % 2) {
    order.reverse();
  }
  for (const [name, size, dense] of [
    ["5356", 5356, false],
    ["32768", 32768, false],
    ["dense32768", 32768, true],
  ]) {
    for (const arm of order) {
      const start = Date.now();
      const response = await fetch(new URL("/api/uploads", arm.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${arm.token}`,
          "content-type": "application/json",
          "user-agent": "postplan-hono-comparison/1.0",
        },
        body: JSON.stringify({ html: fixture(size, dense) }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await response.json();
      records.push({
        arm: arm.name,
        case: name,
        round,
        bytes: size,
        start,
        end: Date.now(),
        status: response.status,
        ray: response.headers.get("cf-ray"),
        body,
      });
      writeFileSync(outputPath, JSON.stringify(records, null, 2));
      assert.equal(
        response.status,
        201,
        "Stop on first failed request; inspect saved evidence before retrying",
      );
    }
  }
}
console.log(
  `Saved ${records.length} uploads. Retain all samples; do not discard startup outliers.`,
);
