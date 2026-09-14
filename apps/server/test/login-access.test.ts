import assert from "node:assert/strict";
import { test } from "bun:test";
import { isLoginAllowed } from "#auth/login-access";
import { parseAllowedLoginDomains } from "#config";

test("allowed login domains are normalized and deduplicated", () => {
  assert.deepEqual(parseAllowedLoginDomains(undefined), []);
  assert.deepEqual(parseAllowedLoginDomains("  "), []);
  assert.deepEqual(parseAllowedLoginDomains("@ABX.com, kinesis.money, abx.com"), [
    "abx.com",
    "kinesis.money",
  ]);
});

test("invalid allowed login domain configuration fails closed", () => {
  for (const value of ["abx.com,", "https://abx.com", "*.abx.com", "-abx.com"]) {
    assert.throws(() => parseAllowedLoginDomains(value), /Invalid POSTPLAN_ALLOWED_LOGIN_DOMAINS/);
  }
});

test("login domain rules require an exact, verified email domain", () => {
  const allowed = ["abx.com", "kinesis.money"];
  assert.equal(isLoginAllowed("person@ABX.COM", true, allowed), true);
  assert.equal(isLoginAllowed("person@kinesis.money", true, allowed), true);
  assert.equal(isLoginAllowed("person@sub.abx.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@notabx.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@other.com@abx.com", true, allowed), false);
  assert.equal(isLoginAllowed("person@abx.com", false, allowed), false);
  assert.equal(isLoginAllowed(null, true, allowed), false);
});

test("login is unrestricted when no domain rules are configured", () => {
  assert.equal(isLoginAllowed(null, undefined, []), true);
  assert.equal(isLoginAllowed("person@anywhere.example", false, []), true);
});
