import assert from "node:assert/strict";

import { test } from "vitest";

import { readCookie, signToken, verifyToken } from "#auth/session";

const secret = "test-secret";
const requestWithCookie = (cookie: string) =>
  new Request("http://localhost", { headers: { cookie } });

test("signed tokens round-trip and carry exp", () => {
  const token = signToken({ accountId: "acct_1" }, secret, 60);
  const payload = verifyToken(token, secret);
  assert.equal(payload?.accountId, "acct_1");
  assert.ok(typeof payload?.exp === "number");
});

test("rejects tampered, wrong-secret, expired, and malformed tokens", () => {
  const token = signToken({ accountId: "acct_1" }, secret, 60);
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ accountId: "acct_2", exp: 9e9 })).toString(
    "base64url",
  );
  assert.equal(verifyToken(`${forgedBody}.${sig}`, secret), null);
  assert.equal(verifyToken(`${body}.${sig}x`, secret), null);
  assert.equal(verifyToken(token, "other-secret"), null);
  assert.equal(verifyToken(signToken({ accountId: "a" }, secret, -10), secret), null);
  assert.equal(verifyToken("no-dot", secret), null);
  assert.equal(verifyToken(undefined, secret), null);
});

test("readCookie finds the named cookie and tolerates bad escapes", () => {
  assert.equal(
    readCookie(requestWithCookie("a=1; postplan_session=abc%2Edef; b=2"), "postplan_session"),
    "abc.def",
  );
  assert.equal(
    readCookie(requestWithCookie("postplan_session=%E0%A4%A"), "postplan_session"),
    null,
  );
  assert.equal(readCookie(requestWithCookie(""), "postplan_session"), null);
});
