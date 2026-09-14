import { MemoryRateLimiter } from "@orpc/ratelimit/memory";
import { config } from "../config.js";
import type { RateLimiters } from "../context.js";

// One set per server instance, so separate servers (and tests) don't share buckets.
export function createRateLimiters(): RateLimiters {
  const { uploadIp, uploadKey, keyMint } = config.rateLimits;
  return {
    "upload-ip": new MemoryRateLimiter(uploadIp),
    "upload-key": new MemoryRateLimiter(uploadKey),
    "key-mint": new MemoryRateLimiter(keyMint),
  };
}
