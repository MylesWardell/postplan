import { test, expect } from "vitest";

import { parseRetentionDays, expired } from "../src/retention";

test("retention accepts configurable whole days and rejects invalid values", () => {
  expect(parseRetentionDays(undefined)).toBe(90);
  for (const value of ["0", "30", "365"]) {
    expect(parseRetentionDays(value)).toBe(Number(value));
  }
  for (const value of ["", " ", "-1", "0.5", "NaN", "Infinity", "1e2", "100000001"]) {
    expect(() => parseRetentionDays(value)).toThrow();
  }
  expect(expired(0, 90, 90 * 86400_000 - 1)).toBe(false);
  expect(expired(0, 90, 90 * 86400_000)).toBe(true);
  expect(expired(0, 0, 365 * 86400_000)).toBe(false);
});
