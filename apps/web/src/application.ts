import { Hono } from "hono";
import { cors } from "hono/cors";
import { createUploadHandler } from "#lib/upload-http";
import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";
import { createContextFactory } from "./context";
import type { ServerDependencies } from "./context";
import { createApiHandler } from "./api";
import { draftResponse } from "#frontend/drafts";
import { notFoundResponse } from "#frontend/response.server";
import { hostDraftId } from "#lib/host-guard";
import { respond } from "#lib/respond";
import { applyContentSecurityPolicy, createNonce } from "#lib/content-security-policy";

// Pages have no Suspense boundaries, so render to a string: streaming SSR encodes
// every chunk and pipes it through router transform streams for no benefit.
const handler = { fetch: createStartHandler(defaultRenderHandler) };
export interface ApplicationOptions {
  compressResponse?: boolean;
  enableEvlog?: boolean;
}

export function createApplication(deps: ServerDependencies, options: ApplicationOptions = {}) {
  const createContext = createContextFactory(deps);
  const api = createApiHandler(createContext, {
    compressResponse: options.compressResponse ?? true,
    enableEvlog: options.enableEvlog ?? true,
  });
  const upload = createUploadHandler(createContext);
  const app = new Hono<{ Bindings: { peerIp: string | null } }>();
  // Preserve document-host isolation before any application route, including uploads.
  app.use("*", async (c, next) => {
    const draftId = hostDraftId(c.req.raw);
    const draft = await draftResponse(c.req.raw, deps, draftId);
    if (draft) {
      return draft;
    }
    if (draftId) {
      return notFoundResponse();
    }
    await next();
    return c.res;
  });
  app.use(
    "/api/uploads",
    cors({
      origin: "*",
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: [
        "Content-Disposition",
        "Standard-Server",
        "Content-Type",
        "Content-Encoding",
        "Authorization",
      ],
      exposeHeaders: [
        "Content-Disposition",
        "Standard-Server",
        "Retry-After",
        "X-Request-Id",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ],
    }),
  );
  app.post("/api/uploads", (c) => upload(c.req.raw, c.env.peerIp));
  const apiRoute = async (request: Request, peerIp: string | null) => {
    const response = await api(request, peerIp);
    return response.headers.get("content-type")?.includes("text/html")
      ? applyContentSecurityPolicy(response, createNonce())
      : response;
  };
  app.all("/api", (c) => apiRoute(c.req.raw, c.env.peerIp));
  app.all("/api/*", (c) => apiRoute(c.req.raw, c.env.peerIp));
  app.all("*", (c) =>
    handler.fetch(c.req.raw, { context: { deps, createContext, api, peerIp: c.env.peerIp } }),
  );
  // Keep the existing error envelope, logging and security headers around all routes.
  app.onError((error) => {
    throw error;
  });
  return (request: Request, peerIp: string | null = null) =>
    respond(() => app.fetch(request, { peerIp }));
}
