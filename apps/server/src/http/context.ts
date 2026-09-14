import { TRPCError } from "@trpc/server";
import { findApiKeyByToken } from "@postplan/database";
import type { Database } from "@postplan/database";
import type { ApiContext } from "@postplan/api/server";
import type { Request } from "express";
import { config } from "../config.js";
import { clientIp } from "./client-ip.js";
import { getHomeUrl, getRequestBaseUrl } from "./public-url.js";
import { readSession } from "../auth/session.js";

export interface ServerDependencies {
  db: Database;
  putHtml: (key: string, html: string) => Promise<void>;
  getHtml: (key: string) => Promise<string>;
}

export function createContextFactory(deps: ServerDependencies) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const limits = {
    "upload-ip": {
      max: Number(process.env.UPLOAD_IP_RATE_LIMIT_MAX || 60),
      window: Number(process.env.UPLOAD_IP_RATE_LIMIT_WINDOW_MS || 60_000),
    },
    "upload-key": {
      max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30),
      window: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60_000),
    },
    "key-mint": {
      max: Number(process.env.KEY_MINT_RATE_LIMIT_MAX || 10),
      window: Number(process.env.KEY_MINT_RATE_LIMIT_WINDOW_MS || 3_600_000),
    },
  };
  let nextSweep = 0;
  const limit: ApiContext["limit"] = (kind, identity) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      nextSweep = now + 60_000;
    }
    const key = `${kind}:${identity}`;
    const rule = limits[kind];
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      // Bound memory even when many unique identities arrive in one window.
      if (buckets.size >= 100_000)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Rate limiter capacity reached.",
        });
      bucket = { count: 0, resetAt: now + rule.window };
      buckets.set(key, bucket);
    }
    if (++bucket.count > rule.max)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded.",
        cause: { retryAfter: Math.ceil((bucket.resetAt - now) / 1000) },
      });
  };
  return async function createContext(req: Request, allowSession = true): Promise<ApiContext> {
    const authorization = req.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const apiKey = token ? await findApiKeyByToken(deps.db, token) : null;
    if (authorization && !apiKey)
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key." });
    const session = allowSession && !authorization ? readSession(req) : null;
    if (session) {
      const home = new URL(
        getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: getRequestBaseUrl(req) }),
      );
      if (
        req.hostname !== home.hostname ||
        (req.method !== "GET" && req.get("origin") !== home.origin)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Session requests must use the application origin.",
        });
      }
    }
    return {
      db: deps.db,
      apiKey,
      session,
      requestBaseUrl: getRequestBaseUrl(req),
      publicBaseUrl: config.publicBaseUrl,
      sourceIp: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
      requestId: req.get(config.requestIdHeader)?.slice(0, 255) ?? null,
      maxHtmlBytes: config.maxHtmlBytes,
      putHtml: deps.putHtml,
      limit,
    };
  };
}
export type ContextFactory = ReturnType<typeof createContextFactory>;
