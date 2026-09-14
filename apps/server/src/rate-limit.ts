import type { Request, RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  key?: (req: Request) => string;
}

// In-process fixed-window limiter. Limits are per server instance: with N
// tasks behind a load balancer the effective ceiling is roughly N × max.
const buckets = new Map<string, Bucket>();

export function createRateLimiter({
  windowMs,
  max,
  keyPrefix,
  key,
}: RateLimiterOptions): RequestHandler {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const identity = key ? key(req) : req.auth?.id || req.ip || "anonymous";
    const bucketKey = `${keyPrefix}:${identity}`;
    const current = buckets.get(bucketKey);

    if (!current || current.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      res.status(429).json({ ok: false, error: "Upload rate limit exceeded." });
      return;
    }

    next();
  };
}
