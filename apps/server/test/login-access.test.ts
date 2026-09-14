import assert from "node:assert/strict";
import { test } from "bun:test";
import { isLoginAllowed } from "#auth/login-access";
import { parseAllowedLoginDomains } from "#config";

test("allowed login domains are normalized and deduplicated", () => {
  assert.deepEqual(parseAllowedLoginDomains(undefined), []);
  assert.deepEqual(parseAllowedLoginDomains("  "), []);
  assert.deepEqual(parseAllowedLoginDomains("@EXAMPLE.com, test.dev, example.com"), [
    "example.com",
    "test.dev",
  ]);
});

test("invalid allowed login domain configuration fails closed", () => {
  for (const value of ["example.com,", "https://example.com", "*.example.com", "-example.com"]) {
    assert.throws(() => parseAllowedLoginDomains(value), /Invalid POSTPLAN_ALLOWED_LOGIN_DOMAINS/);
  }
});

test("login domain rules require an exact, verified email domain", () => {
  const allowed = ["example.com", "test.dev"];
  assert.equal(isLoginAllowed("person@EXAMPLE.COM", true, allowed), true);
  assert.equal(isLoginAllowed("person@test.dev", true, allowed), true);
  assert.equal(isLoginAllowed("person@sub.example.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@notexample.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@other.com@example.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@example.com", false, allowed), false);
  assert.equal(isLoginAllowed(null, true, allowed), false);
});

test("login is unrestricted when no domain rules are configured", () => {
  assert.equal(isLoginAllowed(null, undefined, []), true);
  assert.equal(isLoginAllowed("person@anywhere.example", false, []), true);
});
