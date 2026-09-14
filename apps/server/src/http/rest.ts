import type { Express } from "express";
import { appRouter } from "@postplan/api/server";
import type { ContextFactory } from "./context.js";
import { routeParam } from "./errors.js";

// Compatibility transport for published CLI clients. All operations call the
// same validated procedures as /trpc; no SQL or business rules live here.
export function registerRestRoutes(app: Express, context: ContextFactory): void {
  app.get("/api/me", async (req, res) =>
    res.json(await appRouter.createCaller(await context(req, false)).account.me()),
  );
  app.get("/api/drafts", async (req, res) =>
    res.json(await appRouter.createCaller(await context(req, false)).drafts.list()),
  );
  app.post("/api/api-keys", async (req, res) =>
    res
      .status(201)
      .json(await appRouter.createCaller(await context(req, false)).apiKeys.create(req.body ?? {})),
  );
  app.post("/api/api-keys/:apiKeyId/revoke", async (req, res) =>
    res.json(
      await appRouter
        .createCaller(await context(req, false))
        .apiKeys.revoke({ apiKeyId: routeParam(req, "apiKeyId") }),
    ),
  );
  app.post("/api/uploads", async (req, res) => {
    const result = await appRouter
      .createCaller(await context(req, false))
      .drafts.upload(req.body ?? {});
    res.status(result.ok ? (result.versionNumber === 1 ? 201 : 200) : 422).json(result);
  });
  app.delete("/api/drafts/:draftId", async (req, res) =>
    res.json(
      await appRouter
        .createCaller(await context(req, false))
        .drafts.delete({ draftId: routeParam(req, "draftId") }),
    ),
  );
  app.post("/api/drafts/:draftId/disable", async (req, res) =>
    res.json(
      await appRouter
        .createCaller(await context(req, false))
        .drafts.disable({ ...req.body, draftId: routeParam(req, "draftId") }),
    ),
  );
}
