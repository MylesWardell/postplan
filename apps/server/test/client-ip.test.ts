import assert from "node:assert/strict";
import { test } from "bun:test";
import { clientIp } from "../src/http/client-ip.js";
import { config } from "../src/config.js";
test("ALB ignores forged X-Real-IP and prepended forwarding entries", () => {
  const previous = { ...config };
  try {
    config.clientIpSource = "req-ip";
    config.trustProxy = 1;
    const req = new Request("http://localhost", {
      headers: { "X-Real-IP": "192.0.2.66", "X-Forwarded-For": "192.0.2.66, 198.51.100.42" },
    });
    assert.equal(clientIp(req, "10.0.0.1"), "198.51.100.42");
    config.trustProxy = false;
    assert.equal(clientIp(req, "10.0.0.1"), "10.0.0.1");
    config.trustProxy = "10.0.0.0/8";
    assert.equal(clientIp(req, "10.0.0.1"), "198.51.100.42");
    assert.equal(clientIp(req, "203.0.113.1"), "203.0.113.1");
  } finally {
    Object.assign(config, previous);
  }
});
