import { describe, expect, test } from "vitest";
import { applicationMilliseconds, median } from "./cpu-profile";
import type { CpuProfile } from "./cpu-profile";

const profile = {
  nodes: [
    {
      id: 1,
      callFrame: { functionName: "root", url: "worker.js", lineNumber: 1 },
      children: [2, 4, 5],
    },
    {
      id: 2,
      callFrame: { functionName: "exec", url: "", lineNumber: 1 },
      children: [3],
    },
    { id: 3, callFrame: { functionName: "sqliteChild", url: "worker.js", lineNumber: 1 } },
    { id: 4, callFrame: { functionName: "dashboard", url: "index.js", lineNumber: 1 } },
    { id: 5, callFrame: { functionName: "application", url: "worker.js", lineNumber: 1 } },
  ],
  samples: [1, 2, 3, 4, 5],
  timeDeltas: [100, 200, 300, 400, 500],
} satisfies CpuProfile;

describe("CPU profile comparison", () => {
  test("excludes native and benchmark subtrees", () => {
    expect(applicationMilliseconds(profile, new Set(["dashboard"]))).toBe(0.6);
  });

  test("uses every batch when calculating the median", () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([9, 1, 5, 3])).toBe(4);
  });
});
