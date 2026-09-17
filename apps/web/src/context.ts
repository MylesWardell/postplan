import type { RateLimiter } from "@orpc/ratelimit";
import type { ApiKeyAuth, Store } from "@postplan/store";

import { createRateLimiters } from "#lib/rate-limiters";

export interface ServerDependencies {
  store: Store;
  putHtml: (key: string, html: string) => Promise<void>;
  getHtml: (key: string) => Promise<string | ReadableStream<Uint8Array>>;
}

export type RateLimiters = Record<"upload-ip" | "upload-key" | "key-mint", RateLimiter>;

// Initial context handed to oRPC; middleware in orpc.ts derives the rest.
export interface BaseContext {
  store: Store;
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
  const rateLimiters = createRateLimiters(deps.store);
  return (request: Request, peerIp: string | null, allowSession: boolean): BaseContext => ({
    store: deps.store,
    putHtml: deps.putHtml,
    rateLimiters,
    request,
    peerIp,
    allowSession,
  });
}
export type ContextFactory = ReturnType<typeof createContextFactory>;
