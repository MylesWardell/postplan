// Summarizes a CPU profile, or shows who calls matching functions.
// Usage: node inspect.mjs <file.cpuprofile> [function-prefix...]
import { readFileSync } from "node:fs";

const [file, ...prefixes] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) {
  for (const child of node.children || []) {
    parents.set(child, node.id);
  }
}
const label = (node) =>
  `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber}`;
const top = (map, count) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, ms]) => `${ms.toFixed(1).padStart(8)}  ${key}`)
    .join("\n");

const selfById = new Map();
profile.samples.forEach((id, index) => {
  selfById.set(id, (selfById.get(id) || 0) + profile.timeDeltas[index] / 1000);
});

if (prefixes.length) {
  const subtotal = (id) =>
    (selfById.get(id) || 0) +
    (nodes.get(id).children || []).reduce((sum, child) => sum + subtotal(child), 0);
  for (const prefix of prefixes) {
    const stacks = new Map();
    for (const node of profile.nodes) {
      if (!label(node).startsWith(prefix)) {
        continue;
      }
      const ms = subtotal(node.id);
      if (!ms) {
        continue;
      }
      const chain = [];
      for (let id = parents.get(node.id); id !== undefined && chain.length < 7;) {
        chain.push(label(nodes.get(id)));
        id = parents.get(id);
      }
      const key = chain.join(" <- ");
      stacks.set(key, (stacks.get(key) || 0) + ms);
    }
    console.log(`=== callers of ${prefix}\n${top(stacks, 8)}`);
  }
} else {
  const self = new Map();
  const inclusive = new Map();
  let total = 0;
  for (const [id, ms] of selfById) {
    const node = nodes.get(id);
    if (["(idle)", "(program)"].includes(node.callFrame.functionName)) {
      continue;
    }
    total += ms;
    self.set(label(node), (self.get(label(node)) || 0) + ms);
    const seen = new Set();
    for (let current = id; current !== undefined; current = parents.get(current)) {
      const key = label(nodes.get(current));
      if (!seen.has(key)) {
        seen.add(key);
        inclusive.set(key, (inclusive.get(key) || 0) + ms);
      }
    }
  }
  console.log(`busy ms: ${total.toFixed(1)}`);
  console.log(`--- self\n${top(self, 30)}`);
  console.log(`--- inclusive\n${top(inclusive, 40)}`);
}
