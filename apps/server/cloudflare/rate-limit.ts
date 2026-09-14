import { DurableObject } from "cloudflare:workers";
import { createHmac } from "node:crypto";
import type { RateLimitConfig } from "@postplan/store";

export function limiterName(
  secret: string,
  namespace: string,
  subject: string,
  rule: RateLimitConfig,
) {
  if (!secret) {
    throw new Error("Missing limiter secret.");
  }
  return createHmac("sha256", secret)
    .update(JSON.stringify(["v1", namespace, subject, rule.window, rule.maxRequests]))
    .digest("hex");
}

export function validateRule(rule: RateLimitConfig, weight: number) {
  for (const value of [rule.window, rule.maxRequests, weight]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("Rate-limit values must be positive safe integers.");
    }
  }
}

// Experimental per-subject fixed windows. The existing process-wide epoch cannot
// survive restarts; compare this deliberate window boundary change before rollout.
export class RateLimit extends DurableObject {
  async limit(rule: RateLimitConfig, weight = 1) {
    validateRule(rule, weight);
    const now = Date.now();
    if (!Number.isSafeInteger(now + rule.window)) {
      throw new TypeError("Rate-limit window is too large.");
    }
    const result = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK(id=1), used INTEGER NOT NULL, reset INTEGER NOT NULL)",
      );
      const row = this.ctx.storage.sql
        .exec<{ used: number; reset: number }>("SELECT used, reset FROM counter WHERE id=1")
        .toArray()[0];
      let used = row && row.reset > now ? row.used : 0;
      const reset = row && row.reset > now ? row.reset : now + rule.window;
      const success = weight <= rule.maxRequests - used;
      if (success) {
        used += weight;
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO counter VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET used=excluded.used, reset=excluded.reset",
        used,
        reset,
      );
      return {
        success,
        limit: rule.maxRequests,
        remaining: Math.max(0, rule.maxRequests - used),
        reset,
      };
    });
    await this.ctx.storage.setAlarm(result.reset);
    return result;
  }

  override async alarm() {
    const row = this.ctx.storage.sql
      .exec<{ reset: number }>("SELECT reset FROM counter WHERE id=1")
      .toArray()[0];
    if (row && row.reset > Date.now()) {
      await this.ctx.storage.setAlarm(row.reset);
    } else {
      await this.ctx.storage.deleteAll();
    }
  }
}
