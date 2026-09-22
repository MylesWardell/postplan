import assert from "node:assert/strict";

import { test } from "vitest";

import { isLoginAllowed } from "#auth/login-access";
import { parseAllowedLoginDomains, parseLoginEmails } from "#config";

const unrestricted = { allowedEmails: [], blockedEmails: [], allowedDomains: [] };

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

test("login email lists are normalized, deduplicated, and validated", () => {
  assert.deepEqual(parseLoginEmails("POSTPLAN_ALLOWED_LOGIN_EMAILS", undefined), []);
  assert.deepEqual(
    parseLoginEmails(
      "POSTPLAN_ALLOWED_LOGIN_EMAILS",
      " Person@Example.com, owner@test.dev, person@example.com ",
    ),
    ["person@example.com", "owner@test.dev"],
  );
  for (const value of ["person", "@example.com", "person@", "two@@example.com", "person@-x.com"]) {
    assert.throws(
      () => parseLoginEmails("POSTPLAN_ALLOWED_LOGIN_EMAILS", value),
      /Invalid POSTPLAN_ALLOWED_LOGIN_EMAILS/,
    );
  }
});

test("login domain rules require an exact, verified email domain", () => {
  const rules = { ...unrestricted, allowedDomains: ["example.com", "test.dev"] };
  assert.equal(isLoginAllowed("person@EXAMPLE.COM", true, rules), true);
  assert.equal(isLoginAllowed("person@test.dev", true, rules), true);
  assert.equal(isLoginAllowed("person@sub.example.com", true, rules), false);
  assert.equal(isLoginAllowed("person@notexample.com", true, rules), false);
  assert.equal(isLoginAllowed("person@other.com@example.com", true, rules), false);
  assert.equal(isLoginAllowed("person@example.com", false, rules), false);
  assert.equal(isLoginAllowed(null, true, rules), false);
});

test("exact email allow and block rules are case-insensitive and block wins", () => {
  const allowed = {
    allowedEmails: ["owner@example.com"],
    blockedEmails: [],
    allowedDomains: [],
  };
  assert.equal(isLoginAllowed("Owner@EXAMPLE.COM", true, allowed), true);
  assert.equal(isLoginAllowed("another@example.com", true, allowed), false);
  assert.equal(isLoginAllowed("owner@example.com", false, allowed), false);

  const blocked = {
    allowedEmails: ["owner@example.com"],
    blockedEmails: ["owner@example.com"],
    allowedDomains: ["example.com"],
  };
  assert.equal(isLoginAllowed("owner@example.com", true, blocked), false);
  assert.equal(isLoginAllowed("another@example.com", true, blocked), true);
});

test("a blocklist alone allows other verified email addresses", () => {
  const rules = { ...unrestricted, blockedEmails: ["blocked@example.com"] };
  assert.equal(isLoginAllowed("blocked@example.com", true, rules), false);
  assert.equal(isLoginAllowed("allowed@example.com", true, rules), true);
  assert.equal(isLoginAllowed("allowed@example.com", false, rules), false);
});

test("login is unrestricted when no access rules are configured", () => {
  assert.equal(isLoginAllowed(null, undefined, unrestricted), true);
  assert.equal(isLoginAllowed("person@anywhere.example", false, unrestricted), true);
});
