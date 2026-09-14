import type { RateLimiter } from "@orpc/ratelimit";
import type { ApiKeyAuth } from "./routers/account-store.js";
import type { Database } from "./db/client.js";
import { createRateLimiters } from "./lib/rate-limiters.js";

export interface ServerDependencies {
  db: Database;
  putHtml: (key: string, html: string) => Promise<void>;
  getHtml: (key: string) => Promise<string>;
}

export type RateLimiters = Record<"upload-ip" | "upload-key" | "key-mint", RateLimiter>;

// Initial context handed to oRPC; middleware in orpc.ts derives the rest.
export interface BaseContext {
  db: Database;
  putHtml: (key: string, html: string) => Promise<void>;
  rateLimiters: RateLimiters;
  request: Request;
  peerIp: string | null;
  // Cookie sessions are honoured for the web UI only; the public API is key-only.
  allowSession: boolean;
}

export interface ApiContext extends BaseContext {
  apiKey: ApiKeyAuth | null;
  session: { accountId: string; accountName: string } | null;
  requestBaseUrl: string;
  publicBaseUrl: string | undefined;
  sourceIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  maxHtmlBytes: number;
}

export function createContextFactory(deps: ServerDependencies) {
  const rateLimiters = createRateLimiters();
  return (request: Request, peerIp: string | null, allowSession: boolean): BaseContext => ({
    db: deps.db,
    putHtml: deps.putHtml,
    rateLimiters,
    request,
    peerIp,
    allowSession,
  });
}
export type ContextFactory = ReturnType<typeof createContextFactory>;
