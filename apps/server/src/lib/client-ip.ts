import proxyaddr from "proxy-addr";
import { config } from "../config.js";
import type { TrustProxySetting } from "../config.js";

type TrustFn = (address: string, index: number) => boolean;
let compiled: { setting: TrustProxySetting; trust: TrustFn } | undefined;

// Compile once per trustProxy value instead of on every request.
function trustFor(setting: TrustProxySetting): TrustFn {
  if (compiled?.setting !== setting)
    compiled = {
      setting,
      trust:
        typeof setting === "string"
          ? proxyaddr.compile(setting.split(",").map((value) => value.trim()))
          : typeof setting === "number"
            ? (_address, index) => index < setting
            : () => setting,
    };
  return compiled.trust;
}

// Walk from the socket toward the client, stopping at the first untrusted hop.
// ALB appends the observed client to XFF; its X-Real-IP is not authoritative.
export function clientIp(req: Request, peerIp: string | null): string | null {
  if (config.clientIpSource === "x-real-ip") {
    const realIp = req.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  if (!peerIp) return null;
  const trust = trustFor(config.trustProxy);
  const chain = [
    peerIp,
    ...(req.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((value) => value.trim())
      .reverse() ?? []),
  ];
  for (let i = 0; i < chain.length - 1; i++) {
    if (!trust(chain[i]!, i)) return chain[i]!;
  }
  return chain.at(-1) ?? peerIp;
}
