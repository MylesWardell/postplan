import express from "express";
import type {
  ErrorRequestHandler,
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { PoolClient } from "pg";
import { contentHash, randomToken, sha256 } from "./crypto.js";
import { config } from "./config.js";
import { findApiKeyByToken, newEventId, pool, publicUploadAuth, withTransaction } from "./db.js";
import { HttpError, errorMessage, routeParam, statusCodeOf } from "./http.js";
import { newDraftId, newInternalId } from "./ids.js";
import { renderHome, renderNotFound } from "./render.js";
import { createRateLimiter } from "./rate-limit.js";
import { getHtmlObject, putHtmlObject } from "./storage.js";
import { validateHtml } from "./html-policy.js";
import { clientIp } from "./client-ip.js";
import { listAccountDrafts } from "./drafts.js";
import { registerWebRoutes } from "./web.js";
import {
  getDraftIdFromHost,
  getDraftPublicUrl,
  getDraftRawUrl,
  getHomeUrl,
  getRequestBaseUrl,
} from "./public-url.js";
import type { ApiKeyAuth, DraftRow, DraftVersionRow } from "./types.js";

// Client-supplied provenance attached to an upload. Every field is optional
// and self-reported; values are sanitised with cleanText before storage.
interface UploadMetadata {
  repoOrg?: unknown;
  repoName?: unknown;
  repoHost?: unknown;
  cliVersion?: unknown;
  gitBranch?: unknown;
  gitCommitSha?: unknown;
  gitCommitSubject?: unknown;
  gitDirty?: unknown;
  ciRunUrl?: unknown;
  ciActor?: unknown;
  [key: string]: unknown;
}

interface UploadBody {
  html?: unknown;
  filename?: unknown;
  metadata?: UploadMetadata;
  draftId?: unknown;
  description?: unknown;
}

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  const uploadIpRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_IP_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_IP_RATE_LIMIT_MAX || 60),
    keyPrefix: "upload-ip",
    key: (req) => clientIp(req) || "anonymous",
  });
  const uploadKeyRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30),
    keyPrefix: "upload-key",
    key: (req) => req.auth?.id || clientIp(req) || "anonymous",
  });

  // Scoped to /api so that draft GETs carrying a stray JSON body (some HTTP
  // clients always send Content-Type: application/json) can never fail with a
  // body-parser error instead of the draft HTML.
  app.use("/api", express.json({ limit: process.env.UPLOAD_BODY_LIMIT || "2mb" }));
  app.use(noStoreHeaders);

  app.get("/", async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (draftId) {
        await renderDraft(req, res, { draftId });
        return;
      }

      res.type("html").send(renderHome({ publicBaseUrl: getHomeUrlForRequest(req) }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/healthz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: errorMessage(error) });
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    const auth = authOf(req);
    res.json({
      accountId: auth.account_id,
      accountName: auth.account_name,
      apiKeyId: auth.id,
      apiKeyName: auth.name,
    });
  });

  // The "my docs" feed — shared with the dashboard (src/drafts.ts).
  app.get("/api/drafts", requireAuth, async (req, res, next) => {
    try {
      const drafts = await listAccountDrafts(authOf(req).account_id, {
        requestBaseUrl: getRequestBaseUrl(req),
      });
      res.json({ ok: true, drafts });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys", requireAuth, async (req, res, next) => {
    try {
      const token = `pp_${randomToken(32)}`;
      const apiKeyId = newInternalId();
      const name = cleanText(req.body?.name) || "CLI API Key";

      await pool.query(
        `
          INSERT INTO api_keys (id, account_id, name, key_hash)
          VALUES ($1, $2, $3, $4)
        `,
        [apiKeyId, authOf(req).account_id, name, sha256(token)],
      );

      res.status(201).json({
        ok: true,
        apiKey: {
          id: apiKeyId,
          name,
        },
        token,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys/:apiKeyId/revoke", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE api_keys
          SET revoked_at = now()
          WHERE id = $1
            AND account_id = $2
            AND revoked_at IS NULL
          RETURNING id
        `,
        [routeParam(req, "apiKeyId"), authOf(req).account_id],
      );

      if (!result.rowCount) {
        res.status(404).json({ ok: false, error: "API key not found." });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/uploads",
    uploadIpRateLimit,
    optionalUploadAuth,
    uploadKeyRateLimit,
    async (req, res, next) => {
      try {
        const auth = authOf(req);
        const body: UploadBody = req.body || {};
        const { html, filename, draftId, description } = body;
        const metadata: UploadMetadata = isPlainObject(body.metadata) ? body.metadata : {};
        const validation = validateHtml(html, { maxBytes: config.maxHtmlBytes });

        if (!validation.ok || typeof html !== "string") {
          res.status(422).json({
            ok: false,
            errors: validation.errors,
            warnings: validation.warnings,
          });
          return;
        }

        const byteLength = Buffer.byteLength(html, "utf8");
        const nowHash = contentHash(html);
        const sourceIp = clientIp(req);
        // The edge's request id (Railway: X-Railway-Request-Id, ALB:
        // X-Amzn-Trace-Id) is stored verbatim for correlating with its logs
        // rather than minting our own.
        const requestId = cleanText(req.get(config.requestIdHeader));
        const stats = validation.stats;
        // Any truthy draftId is an update attempt; a non-string simply won't match
        // an owned draft and 404s, exactly as before the TypeScript conversion.
        const requestedDraftId = draftId ? String(draftId) : null;

        const result = await withTransaction(async (client) => {
          const existingDraft = requestedDraftId
            ? await findOwnedDraft(client, requestedDraftId, auth.account_id)
            : null;

          if (requestedDraftId && !existingDraft) {
            throw new HttpError(404, "Draft not found.");
          }

          const draft = existingDraft || {
            id: newDraftId(),
            account_id: auth.account_id,
          };

          const versionNumber = existingDraft
            ? Number(
                (
                  await client.query<{ next_version: number }>(
                    "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM draft_versions WHERE draft_id = $1",
                    [draft.id],
                  )
                ).rows[0]?.next_version,
              )
            : 1;

          const versionId = newInternalId();
          const objectKey = `drafts/${draft.id}/versions/${versionId}.html`;
          const title =
            validation.title ||
            existingDraft?.title ||
            (typeof filename === "string" && filename) ||
            "Untitled Draft";

          await putHtmlObject(objectKey, html);

          if (!existingDraft) {
            await client.query(
              `
              INSERT INTO drafts (id, account_id, title, description, repo_org, repo_name, repo_host)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
              [
                draft.id,
                auth.account_id,
                title,
                cleanText(description, 1000),
                cleanText(metadata.repoOrg),
                cleanText(metadata.repoName),
                cleanText(metadata.repoHost),
              ],
            );
          }

          await client.query(
            `
            INSERT INTO draft_versions (
              id, draft_id, version_number, object_key, content_hash, file_size,
              created_by_api_key_id, source_ip, user_agent, cli_version,
              git_branch, git_commit_sha, original_filename,
              git_commit_subject, git_dirty, request_id, has_inline_script,
              external_image_hosts, ci_run_url, ci_actor
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20)
          `,
            [
              versionId,
              draft.id,
              versionNumber,
              objectKey,
              nowHash,
              byteLength,
              auth.id,
              sourceIp,
              req.get("user-agent") || null,
              cleanText(metadata.cliVersion),
              cleanText(metadata.gitBranch),
              cleanText(metadata.gitCommitSha),
              cleanText(filename),
              cleanText(metadata.gitCommitSubject),
              typeof metadata.gitDirty === "boolean" ? metadata.gitDirty : null,
              requestId,
              stats.hasInlineScript,
              JSON.stringify(stats.externalImageHosts || []),
              cleanText(metadata.ciRunUrl),
              cleanText(metadata.ciActor),
            ],
          );

          await client.query(
            `
            UPDATE drafts
            SET current_version_id = $1,
                title = $2,
                description = COALESCE($3, description),
                repo_org = COALESCE($4, repo_org),
                repo_name = COALESCE($5, repo_name),
                repo_host = COALESCE($6, repo_host),
                updated_at = now()
            WHERE id = $7
          `,
            [
              versionId,
              title,
              cleanText(description, 1000),
              cleanText(metadata.repoOrg),
              cleanText(metadata.repoName),
              cleanText(metadata.repoHost),
              draft.id,
            ],
          );

          await client.query(
            `
            INSERT INTO upload_events (
              id, draft_id, draft_version_id, api_key_id, event_type,
              source_ip, user_agent, metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
            [
              newEventId(),
              draft.id,
              versionId,
              auth.id,
              existingDraft ? "draft.updated" : "draft.created",
              sourceIp,
              req.get("user-agent") || null,
              metadata,
            ],
          );

          return {
            draftId: draft.id,
            versionId,
            versionNumber,
            title,
            requestId,
            publicUrl: getDraftPublicUrl({
              draftId: draft.id,
              publicBaseUrl: config.publicBaseUrl,
              requestBaseUrl: getRequestBaseUrl(req),
            }),
            rawUrl: getDraftRawUrl({
              draftId: draft.id,
              publicBaseUrl: config.publicBaseUrl,
              requestBaseUrl: getRequestBaseUrl(req),
            }),
            warnings: validation.warnings,
          };
        });

        res.status(requestedDraftId ? 200 : 201).json({ ok: true, ...result });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete("/api/drafts/:draftId", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE drafts
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [routeParam(req, "draftId"), authOf(req).account_id],
      );

      if (!result.rowCount) {
        res.status(404).json({ ok: false, error: "Draft not found." });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/drafts/:draftId/disable", requireAuth, async (req, res, next) => {
    try {
      const reason = cleanText(req.body?.reason) || "Disabled by owner.";
      const result = await pool.query(
        `
          UPDATE drafts
          SET disabled_at = now(), disabled_reason = $3, updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [routeParam(req, "draftId"), authOf(req).account_id, reason],
      );

      if (!result.rowCount) {
        res.status(404).json({ ok: false, error: "Draft not found." });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  registerWebRoutes(app);

  // Every draft URL serves the raw uploaded HTML. The `/raw` aliases are kept
  // because the upload API and CLI hand them out as the canonical agent URL.
  const serveCurrent: RequestHandler = async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (!draftId) {
        next();
        return;
      }
      await renderDraft(req, res, { draftId });
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
      await renderDraft(req, res, {
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
      await renderDraft(req, res, { draftId: routeParam(req, "draftId") });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    ["/d/:draftId/v/:versionNumber", "/d/:draftId/v/:versionNumber/raw"],
    async (req, res, next) => {
      try {
        await renderDraft(req, res, {
          draftId: routeParam(req, "draftId"),
          versionNumber: Number(routeParam(req, "versionNumber")),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).type("html").send(renderNotFound());
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = statusCodeOf(error);
    const message = status >= 500 ? "Internal server error." : errorMessage(error);
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ ok: false, error: message });
  };
  app.use(errorHandler);

  return app;
}

// Serve the exact uploaded HTML, byte for byte, to EVERY client — browsers,
// curl, and agent fetchers alike. There is deliberately no browser detection,
// iframe wrapper, or consent interstitial: any heuristic that tried to tell an
// agent from a browser inevitably misclassified some agent fetcher and hid the
// draft content the service exists to share. A draft URL is now just its HTML.
async function renderDraft(
  _req: Request,
  res: Response,
  { draftId, versionNumber }: { draftId: string; versionNumber?: number },
): Promise<void> {
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    res.status(404).type("html").send(renderNotFound());
    return;
  }

  const { draft, version } = await findPublicDraftVersion(draftId, versionNumber);
  if (!draft || !version) {
    res.status(404).type("html").send(renderNotFound());
    return;
  }

  const html = await getHtmlObject(version.object_key);
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

async function findPublicDraftVersion(
  draftId: string,
  versionNumber: number | undefined,
): Promise<{ draft: DraftRow | null; version: DraftVersionRow | null }> {
  const draftResult = await pool.query<DraftRow>(
    `
      SELECT *
      FROM drafts
      WHERE id = $1
        AND deleted_at IS NULL
        AND disabled_at IS NULL
      LIMIT 1
    `,
    [draftId],
  );

  const draft = draftResult.rows[0] ?? null;
  if (!draft) return { draft: null, version: null };

  const versionResult = versionNumber
    ? await pool.query<DraftVersionRow>(
        `
          SELECT *
          FROM draft_versions
          WHERE draft_id = $1 AND version_number = $2
          LIMIT 1
        `,
        [draft.id, versionNumber],
      )
    : await pool.query<DraftVersionRow>("SELECT * FROM draft_versions WHERE id = $1 LIMIT 1", [
        draft.current_version_id,
      ]);

  return { draft, version: versionResult.rows[0] ?? null };
}

async function findOwnedDraft(
  client: PoolClient,
  draftId: string,
  accountId: string,
): Promise<DraftRow | null> {
  const result = await client.query<DraftRow>(
    `
      SELECT *
      FROM drafts
      WHERE id = $1
        AND account_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [draftId, accountId],
  );
  return result.rows[0] ?? null;
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await optionalAuth(req);
  if (!auth) {
    res.status(401).json({ ok: false, error: "Missing or invalid API key." });
    return;
  }
  req.auth = auth;
  next();
}

async function optionalUploadAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.auth = (await optionalAuth(req)) || publicUploadAuth;
  next();
}

async function optionalAuth(req: Request): Promise<ApiKeyAuth | null> {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  return findApiKeyByToken(match[1].trim());
}

// Only valid behind requireAuth/optionalUploadAuth, which always set req.auth.
function authOf(req: Request): ApiKeyAuth {
  if (!req.auth) {
    throw new Error("authOf() called on a route without auth middleware.");
  }
  return req.auth;
}

function noStoreHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function getHomeUrlForRequest(req: Request): string {
  return getHomeUrl({
    publicBaseUrl: config.publicBaseUrl,
    requestBaseUrl: getRequestBaseUrl(req),
  });
}

function getDraftIdFromRequest(req: Request): string | null {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host"),
  });
}

function cleanText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function isPlainObject(value: unknown): value is UploadMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
