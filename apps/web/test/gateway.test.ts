import { test, expect } from "vitest";
import { gatewayRequest } from "#lib/gateway";
import { config } from "#config";
import { clientIp } from "#lib/client-ip";

test("gateway context preserves public origin/body and overrides forged proxy headers", async () => {
  const before = { ...config };
  config.apiGateway = true;
  config.publicBaseUrl = "https://*.plans.example.com";
  try {
    const context = {
      domainName: "plans.example.com",
      requestId: "gateway-id",
      http: { sourceIp: "192.0.2.1" },
    };
    const result = gatewayRequest(
      new Request("http://localhost:3000/api/uploads?q=yes", {
        method: "POST",
        body: "payload",
        headers: {
          "x-amzn-request-context": JSON.stringify(context),
          "x-forwarded-for": "attacker",
          "x-real-ip": "attacker",
          "x-forwarded-host": "evil.example",
        },
      }),
    );
    expect(result.request.url).toBe("https://plans.example.com/api/uploads?q=yes");
    expect(await result.request.text()).toBe("payload");
    expect(result.request.headers.get("x-forwarded-for")).toBeNull();
    expect(result.request.headers.get(config.requestIdHeader)).toBe("gateway-id");
    expect(clientIp(result.request, result.peerIp)).toBe("192.0.2.1");
    for (const domainName of [
      "evil.example",
      "plans.example.com.evil.example",
      "*.plans.example.com",
      "api.plans.example.com",
    ]) {
      expect(() =>
        gatewayRequest(
          new Request("http://localhost:3000", {
            headers: { "x-amzn-request-context": JSON.stringify({ ...context, domainName }) },
          }),
        ),
      ).toThrow();
    }
    expect(
      gatewayRequest(
        new Request("http://localhost:3000", {
          headers: {
            "x-amzn-request-context": JSON.stringify({
              ...context,
              domainName: "abcdefghijkl.plans.example.com",
            }),
          },
        }),
      ).request.url,
    ).toBe("https://abcdefghijkl.plans.example.com/");
    expect(() => gatewayRequest(new Request("http://localhost:3000"))).toThrow();
  } finally {
    Object.assign(config, before);
  }
});
