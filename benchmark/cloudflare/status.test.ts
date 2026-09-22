import { expect, test } from "vitest";

import { assertStatuses } from "./status";

test("accepts expected successful and rejected batches", () => {
  for (const [scenario, code] of [
    ["upload", 201],
    ["healthz", 200],
    ["uploadMalformedGzip", 400],
    ["uploadUnauthorized", 401],
    ["uploadIpLimited", 429],
    ["uploadKeyLimited", 429],
  ] as const) {
    expect(() => assertStatuses(scenario, { [code]: 3 }, 3)).not.toThrow();
  }
});

test("rejects unexpected successes, mixed statuses, empty and incomplete batches", () => {
  const batches: Record<string, number>[] = [
    { "201": 3 },
    { "429": 2, "500": 1 },
    {},
    { "429": 2 },
  ];
  for (const statuses of batches) {
    expect(() => assertStatuses("uploadIpLimited", statuses, 3)).toThrow();
  }
});
