import { createHash, createHmac, randomUUID } from "node:crypto";
import sql from "./sql.json";
import type { z } from "zod";
import type { uploadInput, uploadOutput } from "@postplan/api/schemas";
import { UploadFailure } from "./http";
import { cleanText as clean } from "../../store/src/text";
import type { Bindings } from "./bindings";
import { getDraftPublicUrl, getDraftRawUrl } from "@postplan/store/public-url";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function limited(env: Bindings, namespace: string, subject: string, maxRequests: number) {
  if (!env.POSTPLAN_RATE_LIMIT_SECRET) {
    throw new Error("Missing limiter secret");
  }
  const rule = { window: 60000, maxRequests };
  const name = createHmac("sha256", env.POSTPLAN_RATE_LIMIT_SECRET)
    .update(JSON.stringify(["v1", namespace, subject, rule.window, maxRequests]))
    .digest("hex");
  return (await env.RATE_LIMITS.getByName(name).limit(rule)).success;
}
export async function upload(
  req: Request,
  env: Bindings,
  input: z.infer<typeof uploadInput>,
): Promise<z.infer<typeof uploadOutput>> {
  if (String(env.UPLOAD_ENABLED) !== "true") {
    throw new UploadFailure(503, "Uploads disabled");
  }
  const db = env.POSTPLAN_DB;
  const stmt = (name: keyof typeof sql, params: unknown[] = []) =>
    db.prepare(sql[name]).bind(...params);
  const guard = await stmt("guard").first<{ killed: number }>();
  if (!guard) {
    throw new UploadFailure(503, "Storage uninitialized");
  }
  if (guard.killed !== 0) {
    throw new UploadFailure(503, "Application stopped");
  }
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new UploadFailure(401, "API key required");
  }
  if (!env.TEST_ACCOUNT_ID) {
    throw new UploadFailure(503, "Test account missing");
  }
  const auth = await stmt("auth", [hash(header.slice(7)), env.TEST_ACCOUNT_ID]).first<{
    id: string;
    account_id: string;
    last_used_at: number | null;
  }>();
  if (!auth) {
    throw new UploadFailure(401, "Invalid API key");
  }
  const now = Date.now();
  if (auth.last_used_at === null || now - auth.last_used_at >= 60000) {
    await stmt("touch", [now, auth.id]).run();
  }
  const ip = req.headers.get("cf-connecting-ip") || "anonymous";
  if (
    !(await limited(env, "upload-ip", ip, 60)) ||
    !(await limited(env, "upload-key", auth.id, 30))
  ) {
    throw new UploadFailure(429, "Rate limited");
  }
  const html = input.html;
  if (typeof html !== "string" || html.trim() === "") {
    throw new UploadFailure(422, "HTML document is empty");
  }
  if (Buffer.byteLength(html, "utf8") > 32768) {
    throw new UploadFailure(422, "HTML document exceeds 32768 bytes");
  }
  const validation = await env.HTML_VALIDATOR.validate(html, { maxBytes: 32768, maxDepth: 64 });
  if (!validation.ok || typeof html !== "string") {
    throw new UploadFailure(422, "HTML validation failed", {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }
  const updating = input.draftId != null;
  const draftId = updating ? String(input.draftId) : randomUUID().replaceAll("-", "").slice(0, 12);
  if (updating && !(await stmt("owned", [draftId, auth.account_id]).first())) {
    throw new UploadFailure(404, "Draft not found");
  }
  const versionId = randomUUID();
  const key = `drafts/${draftId}/versions/${versionId}.html`;
  const bytes = Buffer.byteLength(html);
  if (!(await stmt("reserve", [bytes, bytes]).first())) {
    throw new UploadFailure(429, "Storage budget exhausted or application stopped");
  }
  await env.HTML_BUCKET.put(key, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store" },
  });
  const metadata = input.metadata ?? {};
  const title = validation.title || input.filename || "Untitled Draft";
  const description = clean(input.description, 1000);
  const repo = ["repoOrg", "repoName", "repoHost"].map((k) => clean(metadata[k]));
  const agent = req.headers.get("user-agent");
  const requestId = req.headers.get("cf-ray") || randomUUID();
  const statements = [];
  if (!updating) {
    statements.push(stmt("draft", [draftId, auth.account_id, title, description, ...repo]));
  }
  statements.push(
    stmt("version", [
      versionId,
      draftId,
      auth.account_id,
      draftId,
      key,
      hash(html),
      bytes,
      auth.id,
      ip,
      agent,
      requestId,
      clean(metadata.cliVersion),
      clean(metadata.gitBranch),
      clean(metadata.gitCommitSha),
      clean(metadata.gitCommitSubject),
      typeof metadata.gitDirty === "boolean" ? Number(metadata.gitDirty) : null,
      clean(input.filename),
      Number(validation.hasScripts),
      JSON.stringify(validation.stats.externalImageHosts),
      clean(metadata.ciRunUrl),
      clean(metadata.ciActor),
    ]),
  );
  statements.push(
    stmt("current", [
      versionId,
      validation.title,
      title,
      now,
      description,
      ...repo,
      draftId,
      auth.account_id,
    ]),
  );
  statements.push(
    stmt("event", [
      randomUUID(),
      draftId,
      versionId,
      auth.id,
      updating ? "draft.updated" : "draft.created",
      ip,
      agent,
      JSON.stringify(metadata),
    ]),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (updating && !(await stmt("owned", [draftId, auth.account_id]).first())) {
      throw new UploadFailure(404, "Draft not found");
    }
    throw error;
  }
  const result = await stmt("result", [versionId]).first<{
    version_number: number;
    title: string;
  }>();
  if (!result) {
    throw new Error("Missing upload");
  }
  return {
    status: updating ? 200 : 201,
    body: {
      ok: true,
      draftId,
      versionId,
      versionNumber: result.version_number,
      title: result.title,
      requestId,
      publicUrl: getDraftPublicUrl({
        draftId,
        publicBaseUrl: env.POSTPLAN_PUBLIC_BASE_URL,
        requestBaseUrl: new URL(req.url).origin,
      }),
      rawUrl: getDraftRawUrl({
        draftId,
        publicBaseUrl: env.POSTPLAN_PUBLIC_BASE_URL,
        requestBaseUrl: new URL(req.url).origin,
      }),
      warnings: validation.warnings,
    },
  };
}
