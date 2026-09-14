import type { Express, Request, RequestHandler, Response } from "express";
import type { Database } from "@postplan/database";
import { findPublicDraftVersion } from "@postplan/api/drafts";
import { config } from "../config.js";
import type { ServerDependencies } from "./context.js";
import { routeParam } from "./errors.js";
import { renderHome, renderNotFound } from "../views/home.js";
import { getDraftIdFromHost, getHomeUrl, getRequestBaseUrl } from "./public-url.js";

export function registerDraftRoutes(app: Express, deps: ServerDependencies): void {
  app.get("/", async (req, res) => {
    const draftId = getDraftIdFromRequest(req);
    if (draftId) return renderDraft(deps.db, deps.getHtml, req, res, { draftId });
    res.type("html").send(
      renderHome({
        publicBaseUrl: getHomeUrl({
          publicBaseUrl: config.publicBaseUrl,
          requestBaseUrl: getRequestBaseUrl(req),
        }),
      }),
    );
  });
  // Every draft URL serves the raw uploaded HTML. The `/raw` aliases are kept
  // because the upload API and CLI hand them out as the canonical agent URL.
  const serveCurrent: RequestHandler = async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (!draftId) {
        next();
        return;
      }
      await renderDraft(deps.db, deps.getHtml, req, res, { draftId });
    } catch (error) {
      next(error);
    }
  };

  const serveVersion: RequestHandler = async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (!draftId) {
        next();
        return;
      }
      await renderDraft(deps.db, deps.getHtml, req, res, {
        draftId,
        versionNumber: Number(routeParam(req, "versionNumber")),
      });
    } catch (error) {
      next(error);
    }
  };

  app.get("/raw", serveCurrent);
  app.get("/v/:versionNumber", serveVersion);
  app.get("/v/:versionNumber/raw", serveVersion);

  app.get(["/d/:draftId", "/d/:draftId/raw"], async (req, res, next) => {
    try {
      await renderDraft(deps.db, deps.getHtml, req, res, { draftId: routeParam(req, "draftId") });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    ["/d/:draftId/v/:versionNumber", "/d/:draftId/v/:versionNumber/raw"],
    async (req, res, next) => {
      try {
        await renderDraft(deps.db, deps.getHtml, req, res, {
          draftId: routeParam(req, "draftId"),
          versionNumber: Number(routeParam(req, "versionNumber")),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}

// Serve the exact uploaded HTML, byte for byte, to EVERY client — browsers,
// curl, and agent fetchers alike. There is deliberately no browser detection,
// iframe wrapper, or consent interstitial: any heuristic that tried to tell an
// agent from a browser inevitably misclassified some agent fetcher and hid the
// draft content the service exists to share. A draft URL is now just its HTML.
async function renderDraft(
  db: Database,
  getHtml: (key: string) => Promise<string>,
  _req: Request,
  res: Response,
  { draftId, versionNumber }: { draftId: string; versionNumber?: number },
): Promise<void> {
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    res.status(404).type("html").send(renderNotFound());
    return;
  }

  const { draft, version } = await findPublicDraftVersion(db, draftId, versionNumber);
  if (!draft || !version) {
    res.status(404).type("html").send(renderNotFound());
    return;
  }

  const html = await getHtml(version.object_key);
  res.setHeader("Content-Security-Policy", draftContentSecurityPolicy());
  res.setHeader("X-Postplan-Draft-Id", draft.id);
  res.setHeader("X-Postplan-Draft-Version", String(Number(version.version_number)));
  res.type("html").send(html);
}

// A CSP is the only thing kept from the old serving path. It never alters the
// bytes a curl/agent client reads, so it does not gate content in any way; it
// only constrains what the page may do if a human opens it in a browser —
// blocking script execution, cross-origin network requests, and form posts.
// Uploaded drafts are already external-script/-form/-iframe free (see
// validateHtml) and live on isolated per-draft origins.
function draftContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function getDraftIdFromRequest(req: Request): string | null {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host"),
  });
}
