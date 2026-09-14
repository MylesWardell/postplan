import type { Request } from "express";
import { config } from "../config.js";

// Two edge topologies are supported, selected by CLIENT_IP_SOURCE:
//
// "x-real-ip" (default, Railway): Railway's edge sets `X-Real-IP` to the
// client's remote address and documents it as the header for identifying the
// client IP: https://docs.railway.com/networking/public-networking/specs-and-limits
// Behind Railway, Express's `req.ip` (with `trust proxy` = true) reads the
// LEFT-MOST `X-Forwarded-For` entry, which a client can spoof by prepending a
// fake value — so it must not be used for abuse logging or rate-limit keys.
// We fall back to `req.ip` only for local runs where the edge header is absent.
//
// "req-ip" (AWS ALB/CloudFront): those edges do NOT set or strip `X-Real-IP`,
// so a client could forge it. Instead they append the observed peer address
// to `X-Forwarded-For`; with TRUST_PROXY set to the exact number of proxy hops
// (1 for ALB alone), Express's `req.ip` is that edge-observed address.
export function clientIp(req: Request): string | null {
  if (config.clientIpSource === "x-real-ip") {
    const realIp = req.get("x-real-ip");
    if (typeof realIp === "string" && realIp.trim()) {
      return realIp.trim();
    }
  }
  return req.ip || null;
}
