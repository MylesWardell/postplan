import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { clientIp } from "../src/client-ip.js";
import { config } from "../src/config.js";

test("ALB configuration ignores forged X-Real-IP and prepended forwarding entries", async () => {
  const previous = config.clientIpSource;
  config.clientIpSource = "req-ip";
  const app = express();
  app.set("trust proxy", 1);
  app.get("/", (req, res) => res.json({ ip: clientIp(req) }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { "X-Real-IP": "192.0.2.66", "X-Forwarded-For": "192.0.2.66, 198.51.100.42" },
    });
    assert.deepEqual(await response.json(), { ip: "198.51.100.42" });
  } finally {
    config.clientIpSource = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
