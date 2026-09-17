export type CallFrame = {
  functionName: string;
  url: string;
  lineNumber: number;
};

export type CpuProfileNode = {
  id: number;
  callFrame: CallFrame;
  children?: number[];
};

export type CpuProfile = {
  nodes: CpuProfileNode[];
  samples: number[];
  timeDeltas: number[];
};

export const excludedNativeFunctions = new Set([
  "exec",
  "toArray",
  "one",
  "raw",
  "transactionSync",
]);

export function parseCpuProfile(value: string): CpuProfile {
  const profile = JSON.parse(value) as Partial<CpuProfile>;
  if (
    !Array.isArray(profile.nodes) ||
    !Array.isArray(profile.samples) ||
    !Array.isArray(profile.timeDeltas) ||
    profile.samples.length !== profile.timeDeltas.length
  ) {
    throw new Error("Invalid CPU profile.");
  }
  return profile as CpuProfile;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate a median without values.");
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle]!;
  return sorted.length % 2 === 1 ? upper : (sorted[middle - 1]! + upper) / 2;
}

export function busyMilliseconds(profile: CpuProfile): number {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  let microseconds = 0;
  profile.samples.forEach((id, index) => {
    const functionName = getNode(nodes, id).callFrame.functionName;
    if (functionName !== "(idle)" && functionName !== "(program)") {
      microseconds += profile.timeDeltas[index]!;
    }
  });
  return microseconds / 1000;
}

export function applicationMilliseconds(
  profile: CpuProfile,
  benchmarkFrames: ReadonlySet<string>,
): number {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = createParentMap(profile);
  const memo = new Map<number, boolean>();
  const excluded = (id: number): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const frame = getNode(nodes, id).callFrame;
    let result =
      (frame.url === "" && excludedNativeFunctions.has(frame.functionName)) ||
      (benchmarkFrames.has(frame.functionName) && frame.url.endsWith("index.js"));
    const parent = parents.get(id);
    if (!result && parent !== undefined) {
      result = excluded(parent);
    }
    memo.set(id, result);
    return result;
  };

  let microseconds = 0;
  profile.samples.forEach((id, index) => {
    const functionName = getNode(nodes, id).callFrame.functionName;
    if (functionName !== "(idle)" && functionName !== "(program)" && !excluded(id)) {
      microseconds += profile.timeDeltas[index]!;
    }
  });
  return microseconds / 1000;
}

export function createParentMap(profile: CpuProfile): Map<number, number> {
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }
  return parents;
}

export function getNode(nodes: ReadonlyMap<number, CpuProfileNode>, id: number): CpuProfileNode {
  const node = nodes.get(id);
  if (!node) {
    throw new Error(`CPU profile refers to missing node ${id}.`);
  }
  return node;
}
