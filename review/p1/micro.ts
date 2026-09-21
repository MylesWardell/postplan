// Interleaved micro-benchmark: parse5 policy vs html5ever WASM policy.
// Usage: POLICY_WASM=policy-wasm-036 node --experimental-strip-types review/p1/micro.ts
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { validateHtml } from "../../packages/store/src/html-policy.ts";

const wasmName = process.env.POLICY_WASM ?? "policy-wasm-036";
const bytes = readFileSync(new URL(`./${wasmName}/target/wasm32-unknown-unknown/release/policy_wasm.wasm`, import.meta.url));
let t = performance.now();
const compiled = new WebAssembly.Module(bytes);
const compileMs = performance.now() - t;
t = performance.now();
new WebAssembly.Instance(compiled, {});
const instantiateMs = performance.now() - t;
t = performance.now();
const { validateHtmlWasm } = await import("./candidate.ts");
const importMs = performance.now() - t;

const synthetic = (size: number) => {
  const head = "<!doctype html><html><head><title>Synthetic CPU plan</title></head><body>";
  const piece = "<p>Synthetic review paragraph for bounded CPU testing.</p>";
  const body = head + piece.repeat(Math.floor((size - head.length - 14) / piece.length));
  return body + " ".repeat(size - body.length - 14) + "</body></html>";
};
// Markup-dense plan: nested sections, attributes, tables, inline SVG, code.
const dense = (size: number) => {
  const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dense plan</title><style>.a{color:red}</style></head><body><main class="plan">';
  const piece =
    '<section id="s" class="step"><h2 class="t">Step <code>x</code></h2><ul><li><a href="https://example.com/a?b=1&amp;c=2" title="Link">link</a></li><li><strong>bold</strong> and <em>em</em></li></ul>' +
    '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td data-x="1">1</td><td>2</td></tr></tbody></table>' +
    '<svg viewBox="0 0 10 10" width="10"><path d="M0 0L10 10"/><circle cx="5" cy="5" r="2"/></svg>' +
    '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre><img src="https://img.test/a.png" alt="a"></section>';
  const tail = "</main></body></html>";
  let body = head + piece.repeat(Math.floor((size - head.length - tail.length) / piece.length));
  return body + " ".repeat(size - body.length - tail.length) + tail;
};

const cases = {
  synthetic5k: synthetic(5356),
  synthetic512k: synthetic(512 * 1024 - 64),
  dense5k: dense(5356),
  dense512k: dense(512 * 1024 - 64),
};

for (const [name, html] of Object.entries(cases)) {
  const a = validateHtml(html);
  const b = validateHtmlWasm(html);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`mismatch ${name}`);
}

const rounds = 15;
console.log(JSON.stringify({ wasmName, wasmBytes: bytes.length, compileMs, instantiateMs, importMs }));
for (const [name, html] of Object.entries(cases)) {
  const iterations = html.length > 100_000 ? 10 : 400;
  const samples: Record<string, number[]> = { parse5: [], wasm: [] };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? (["wasm", "parse5"] as const) : (["parse5", "wasm"] as const);
    for (const which of order) {
      const fn = which === "parse5" ? validateHtml : validateHtmlWasm;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) fn(html);
      samples[which]!.push((performance.now() - start) / iterations);
    }
  }
  const median = (xs: number[]) => xs.toSorted((x, y) => x - y)[xs.length >> 1]!;
  const warm = (xs: number[]) => median(xs.slice(3));
  console.log(
    name.padEnd(15),
    `parse5 ${warm(samples.parse5!).toFixed(3)} ms`,
    `wasm ${warm(samples.wasm!).toFixed(3)} ms`,
    `ratio ${(warm(samples.wasm!) / warm(samples.parse5!)).toFixed(2)}`,
  );
}
