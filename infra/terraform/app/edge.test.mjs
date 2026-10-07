import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const { handler: authorize } = require("./edge-authorizer.cjs");
test("origin authentication fails closed and accepts only the exact secret", async () => {
  process.env.ORIGIN_SECRET = "a".repeat(48);
  for (const value of ["", "a", "b".repeat(48)]) {
    assert.deepEqual(await authorize({ headers: { "x-postplan-origin": value } }), {
      isAuthorized: false,
    });
  }
  assert.deepEqual(await authorize({ headers: { "x-postplan-origin": "a".repeat(48) } }), {
    isAuthorized: true,
  });
  delete process.env.ORIGIN_SECRET;
  assert.deepEqual(await authorize({}), { isAuthorized: false });
});
test("VPN gate rejects outsiders regardless of user-agent or forwarded headers", () => {
  const source = readFileSync(new URL("./vpn.js.tftpl", import.meta.url), "utf8").replace(
    "${cidrs}",
    JSON.stringify(["203.0.113.0/24", "198.51.100.5/32"]),
  );
  const handler = runInNewContext(source + "\nhandler");
  const request = {
    headers: { "user-agent": { value: "android tv" }, "x-forwarded-for": { value: "203.0.113.1" } },
  };
  for (const ip of ["203.0.113.1", "203.0.113.255", "198.51.100.5"])
    assert.equal(handler({ viewer: { ip }, request }), request);
  for (const ip of ["203.0.112.255", "203.0.114.0", "198.51.100.4", "::1", "garbage", "999.0.0.1"])
    assert.equal(handler({ viewer: { ip }, request }).statusCode, 403);
});
