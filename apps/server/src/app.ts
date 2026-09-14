import express from "express";
import type { ErrorRequestHandler, Express } from "express";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "@postplan/api/server";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { createContextFactory } from "./http/context.js";
import type { ServerDependencies } from "./http/context.js";
import { registerRestRoutes } from "./http/rest.js";
import { registerDraftRoutes } from "./http/drafts.js";
import { registerWebRoutes } from "./http/web.js";
import { renderNotFound } from "./views/home.js";
import { errorMessage, statusCodeOf } from "./http/errors.js";
import { getDraftIdFromHost } from "./http/public-url.js";

export function createApp(deps: ServerDependencies): Express {
  const app = express();
  const context = createContextFactory(deps);
  app.set("trust proxy", config.trustProxy);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", async (_req, res) => {
    try {
      await deps.db.execute(sql`select 1`);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.use(["/api", "/trpc"], express.json({ limit: process.env.UPLOAD_BODY_LIMIT || "2mb" }));
  app.use(
    "/trpc",
    (req, res, next) => {
      if (getDraftIdFromHost({ publicBaseUrl: config.publicBaseUrl, host: req.hostname })) {
        res.status(404).end();
        return;
      }
      next();
    },
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req }) => context(req),
      allowBatching: false,
    }),
  );
  registerRestRoutes(app, context);
  registerWebRoutes(app, deps.db, context);
  registerDraftRoutes(app, deps);
  app.use((_req, res) => res.status(404).type("html").send(renderNotFound()));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof TRPCError ? getHTTPStatusCodeFromError(error) : statusCodeOf(error);
    if (status >= 500) console.error(error);
    if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS")
      res.setHeader("Retry-After", "60");
    res
      .status(status)
      .json({ ok: false, error: status >= 500 ? "Internal server error." : errorMessage(error) });
  };
  app.use(errors);
  return app;
}
