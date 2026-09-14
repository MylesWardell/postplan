import { MemoryRateLimiter } from "@orpc/ratelimit/memory";
import { config } from "#config";
import type { RateLimiters } from "#context";
import type { Database } from "#db/client";
import { isDynamoDatabase } from "#db/dynamo";
import { DynamoRateLimiter } from "#db/dynamo-rate-limit";

// One set per server instance, so separate servers (and tests) don't share buckets.
export function createRateLimiters(db?: Database): RateLimiters {
  const { uploadIp, uploadKey, keyMint } = config.rateLimits;
  if (db && isDynamoDatabase(db)) {
    return {
      "upload-ip": new DynamoRateLimiter(db, "upload-ip", uploadIp),
      "upload-key": new DynamoRateLimiter(db, "upload-key", uploadKey),
      "key-mint": new DynamoRateLimiter(db, "key-mint", keyMint),
    };
  }
  return {
    "upload-ip": new MemoryRateLimiter(uploadIp),
    "upload-key": new MemoryRateLimiter(uploadKey),
    "key-mint": new MemoryRateLimiter(keyMint),
  };
}
