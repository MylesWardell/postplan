import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { safeNextPath, signIn } from "#auth/handlers";
import { readAuthState } from "#auth/session";
import type * as ConfigModule from "#config";
import { redirect } from "#lib/redirect";

vi.mock("#config", async (importOriginal) => {
  const original = await importOriginal<typeof ConfigModule>();
  return {
    ...original,
    config: {
      ...original.config,
      publicBaseUrl: "https://postplan.example",
      sessionSecret: "login-redirect-test-secret",
    },
  };
});

const origin = "https://postplan.example";

test.each([
  null,
  undefined,
  123,
  "",
  "dashboard",
  "https://example.org/",
  "https://postplan.example/dashboard",
  "//example.org/",
  "///example.org/",
  "/\\example.org/",
  "/dashboard\\settings",
  "/\t/example.org",
  "/\r/example.org",
  "/\n/example.org",
  "/\r\n/example.org",
  "/.//example.org",
  "/dashboard/..//example.org",
  "/%2e//example.org",
])("rejects unsafe or non-local next destination %j", (value) => {
  const path = safeNextPath(value);
  assert.equal(path, "/dashboard");
  const location = redirect(path).headers.get("location");
  assert.ok(location);
  assert.equal(new URL(location, origin).origin, origin);
});

test("rejects every ASCII control character anywhere in the destination", () => {
  for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    for (const value of [
      `/${String.fromCharCode(code)}/example.org`,
      `/dashboard?q=${String.fromCharCode(code)}`,
      `/dashboard#${String.fromCharCode(code)}`,
    ]) {
      assert.equal(safeNextPath(value), "/dashboard", JSON.stringify(value));
    }
  }
});

test.each([
  ["/", "/"],
  ["/dashboard", "/dashboard"],
  ["/dashboard/settings?tab=keys#new", "/dashboard/settings?tab=keys#new"],
  ["/drafts/../dashboard?sort=newest#plans", "/dashboard?sort=newest#plans"],
  [
    "/dashboard/hello world?q=hello world#new plan",
    "/dashboard/hello%20world?q=hello%20world#new%20plan",
  ],
  ["/dashboard?next=https://example.org/#section", "/dashboard?next=https://example.org/#section"],
])("normalizes local destination %j", (value, expected) => {
  const path = safeNextPath(value);
  assert.equal(path, expected);
  assert.equal(safeNextPath(path), path);
  const location = redirect(path).headers.get("location");
  assert.ok(location);
  assert.equal(new URL(location, origin).href, `${origin}${expected}`);
});

test.each([
  ["/%09/example.org", "/dashboard"],
  ["/%0D%0A/example.org", "/dashboard"],
  ["/dashboard/settings%3Ftab=keys%23new", "/dashboard/settings?tab=keys#new"],
])("sanitizes URL-decoded next %j before signing auth state", (next, expected) => {
  const response = signIn(new Request(`${origin}/auth/signin?next=${next}`));
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  const state = readAuthState(new Request(origin, { headers: { cookie: cookie.split(";")[0]! } }));
  assert.equal(state?.next, expected);
});
