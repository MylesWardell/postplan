import { config } from "#config";
import type { RateLimiters } from "#context";
import type { Store, RateLimitConfig } from "@postplan/store";
export function createRateLimiters(store: Store): RateLimiters {
  const limiter = (namespace: string, rule: RateLimitConfig) => ({
    limit: (key: string, { weight = 1 } = {}) => store.rateLimit({ namespace, rule, key, weight }),
  });
  return {
    "upload-ip": limiter("upload-ip", config.rateLimits.uploadIp),
    "upload-key": limiter("upload-key", config.rateLimits.uploadKey),
    "key-mint": limiter("key-mint", config.rateLimits.keyMint),
  };
}
