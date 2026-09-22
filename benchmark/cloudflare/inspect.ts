// Summarizes a CPU profile, or shows who calls matching functions.
// Usage: bun inspect.ts <file.cpuprofile> [function-prefix...]
import { readFileSync } from "node:fs";

import { createParentMap, getNode, parseCpuProfile } from "./cpu-profile";
import type { CpuProfileNode } from "./cpu-profile";

const [file, ...prefixes] = process.argv.slice(2);
if (!file) {
  throw new Error("Usage: bun inspect.ts <file.cpuprofile> [function-prefix...]");
}
const profile = parseCpuProfile(readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = createParentMap(profile);

const selfById = new Map<number, number>();
profile.samples.forEach((id, index) => {
  selfById.set(id, (selfById.get(id) ?? 0) + profile.timeDeltas[index]! / 1000);
});

if (prefixes.length > 0) {
  const subtotal = (id: number): number =>
    (selfById.get(id) ?? 0) +
    (getNode(nodes, id).children ?? []).reduce((sum, child) => sum + subtotal(child), 0);
  for (const prefix of prefixes) {
    const stacks = new Map<string, number>();
    for (const node of profile.nodes) {
      if (!label(node).startsWith(prefix)) {
        continue;
      }
      const milliseconds = subtotal(node.id);
      if (milliseconds === 0) {
        continue;
      }
      const chain: string[] = [];
      let parent = parents.get(node.id);
      while (parent !== undefined && chain.length < 7) {
        chain.push(label(getNode(nodes, parent)));
        parent = parents.get(parent);
      }
      const key = chain.join(" <- ");
      stacks.set(key, (stacks.get(key) ?? 0) + milliseconds);
    }
    console.log(`=== callers of ${prefix}\n${top(stacks, 8)}`);
  }
} else {
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  let total = 0;
  for (const [id, milliseconds] of selfById) {
    const node = getNode(nodes, id);
    if (["(idle)", "(program)"].includes(node.callFrame.functionName)) {
      continue;
    }
    total += milliseconds;
    self.set(label(node), (self.get(label(node)) ?? 0) + milliseconds);
    const seen = new Set<string>();
    let current: number | undefined = id;
    while (current !== undefined) {
      const key = label(getNode(nodes, current));
      if (!seen.has(key)) {
        seen.add(key);
        inclusive.set(key, (inclusive.get(key) ?? 0) + milliseconds);
      }
      current = parents.get(current);
    }
  }
  console.log(`busy ms: ${total.toFixed(1)}`);
  console.log(`--- self\n${top(self, 30)}`);
  console.log(`--- inclusive\n${top(inclusive, 40)}`);
}

function label(node: CpuProfileNode): string {
  const filename = node.callFrame.url.split("/").pop();
  return `${node.callFrame.functionName || "(anon)"} ${filename}:${node.callFrame.lineNumber}`;
}

function top(values: ReadonlyMap<string, number>, count: number): string {
  return [...values]
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([key, milliseconds]) => `${milliseconds.toFixed(1).padStart(8)}  ${key}`)
    .join("\n");
}
