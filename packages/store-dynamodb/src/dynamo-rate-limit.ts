import { createHash } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RateLimiter, RateLimitOptions } from "@orpc/ratelimit";
import type { DynamoDatabase } from "./dynamo";
import { conditionalFailure } from "./dynamo";
import type { RateLimitConfig } from "@postplan/store";

export class DynamoRateLimiter implements RateLimiter {
  constructor(
    private db: DynamoDatabase,
    private namespace: string,
    private rule: RateLimitConfig,
  ) {
    if (
      !Number.isSafeInteger(rule.window) ||
      rule.window <= 0 ||
      !Number.isSafeInteger(rule.maxRequests) ||
      rule.maxRequests <= 0
    ) {
      throw new Error("Rate-limit windows and request limits must be positive integers.");
    }
  }
  async limit(key: string, { weight = 1 }: RateLimitOptions = {}) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new Error("Rate-limit weight must be a positive integer.");
    }
    const start = Math.floor(this.db.now() / this.rule.window) * this.rule.window;
    const reset = start + this.rule.window;
    const base = { limit: this.rule.maxRequests, reset };
    if (weight > this.rule.maxRequests) {
      return { ...base, success: false, remaining: 0 };
    }
    const pk = `${this.namespace}#${createHash("sha256").update(key).digest("hex")}#${start}`;
    try {
      const response = await this.db.client.send(
        new UpdateCommand({
          TableName: this.db.tables.limits,
          Key: { pk },
          UpdateExpression: "SET ttlAt = :ttl ADD #count :weight",
          ConditionExpression: "attribute_not_exists(#count) OR #count <= :remaining",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: {
            ":ttl": Math.ceil(reset / 1000) + 86400,
            ":weight": weight,
            ":remaining": this.rule.maxRequests - weight,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return {
        ...base,
        success: true,
        remaining: Math.max(0, this.rule.maxRequests - Number(response.Attributes?.count)),
      };
    } catch (error) {
      if (conditionalFailure(error)) {
        return { ...base, success: false, remaining: 0 };
      }
      throw error;
    }
  }
}
