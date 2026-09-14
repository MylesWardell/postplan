import { createHash, randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { drafts, draftVersions, uploadEvents } from "#db/schema";
import { publicUploadAuth } from "./account-store.js";
import type { Database } from "#db/client";
import { validateHtml } from "#lib/html-policy";
import { getDraftPublicUrl, getDraftRawUrl } from "#lib/public-url";
import type { ApiContext } from "#context";

const newDraftId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);
export function cleanText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLength) || null;
}
interface UrlContext {
  publicBaseUrl: string | undefined;
  requestBaseUrl: string;
}
const urls = (draftId: string, context: UrlContext) => ({
  publicUrl: getDraftPublicUrl({ draftId, ...context }),
  rawUrl: getDraftRawUrl({ draftId, ...context }),
});

export async function listAccountDrafts(db: Database, accountId: string, context: UrlContext) {
  const counts = db
    .select({ draft_id: draftVersions.draft_id, version_count: count().as("version_count") })
    .from(draftVersions)
    .groupBy(draftVersions.draft_id)
    .as("version_counts");
  const rows = await db
    .select({
      draft: drafts,
      latest: { number: draftVersions.version_number, date: draftVersions.created_at },
      count: counts.version_count,
    })
    .from(drafts)
    .leftJoin(draftVersions, eq(draftVersions.id, drafts.current_version_id))
    .leftJoin(counts, eq(counts.draft_id, drafts.id))
    .where(and(eq(drafts.account_id, accountId), isNull(drafts.deleted_at)))
    .orderBy(desc(drafts.updated_at));
  return rows.map(({ draft, latest, count: versionCount }) => ({
    draftId: draft.id,
    title: draft.title,
    description: draft.description,
    repoOrg: draft.repo_org,
    repoName: draft.repo_name,
    repoHost: draft.repo_host,
    latestVersionNumber: latest?.number ?? null,
    latestVersionAt: latest?.date ?? null,
    versionCount: Number(versionCount ?? 0),
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    disabled: Boolean(draft.disabled_at),
    ...urls(draft.id, context),
  }));
}
export type AccountDraft = Awaited<ReturnType<typeof listAccountDrafts>>[number];

export async function getAccountDraftWithVersions(
  db: Database,
  accountId: string,
  draftId: string,
  context: UrlContext,
) {
  const [draft] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.account_id, accountId), isNull(drafts.deleted_at)))
    .limit(1);
  if (!draft) return null;
  const versions = await db
    .select({
      id: draftVersions.id,
      version_number: draftVersions.version_number,
      created_at: draftVersions.created_at,
      git_branch: draftVersions.git_branch,
      git_commit_sha: draftVersions.git_commit_sha,
      git_commit_subject: draftVersions.git_commit_subject,
      git_dirty: draftVersions.git_dirty,
      file_size: draftVersions.file_size,
    })
    .from(draftVersions)
    .where(eq(draftVersions.draft_id, draftId))
    .orderBy(desc(draftVersions.version_number));
  return {
    draft: {
      draftId,
      title: draft.title,
      description: draft.description,
      disabled: Boolean(draft.disabled_at),
      ...urls(draftId, context),
    },
    versions,
  };
}
export type AccountDraftDetail = NonNullable<
  Awaited<ReturnType<typeof getAccountDraftWithVersions>>
>;

export async function findPublicDraftVersion(
  db: Database,
  draftId: string,
  versionNumber?: number,
) {
  const [row] = await db
    .select({ draft: drafts, version: draftVersions })
    .from(drafts)
    .innerJoin(
      draftVersions,
      and(
        eq(draftVersions.draft_id, drafts.id),
        versionNumber === undefined
          ? eq(draftVersions.id, drafts.current_version_id)
          : eq(draftVersions.version_number, versionNumber),
      ),
    )
    .where(and(eq(drafts.id, draftId), isNull(drafts.deleted_at), isNull(drafts.disabled_at)))
    .limit(1);
  return row ?? { draft: null, version: null };
}

export async function updateOwnedDraft(
  db: Database,
  accountId: string,
  draftId: string,
  values: Partial<
    Pick<
      typeof drafts.$inferInsert,
      "title" | "description" | "disabled_at" | "disabled_reason" | "deleted_at"
    >
  >,
) {
  const [draft] = await db
    .update(drafts)
    .set({ ...values, updated_at: new Date() })
    .where(and(eq(drafts.id, draftId), eq(drafts.account_id, accountId), isNull(drafts.deleted_at)))
    .returning({ id: drafts.id });
  if (!draft) throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  return { ok: true as const };
}

export interface UploadInput {
  html?: unknown;
  filename?: string;
  draftId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
export async function uploadDraft(ctx: ApiContext, input: UploadInput) {
  const validation = validateHtml(input.html, { maxBytes: ctx.maxHtmlBytes });
  if (!validation.ok || typeof input.html !== "string")
    return { ok: false as const, errors: validation.errors, warnings: validation.warnings };
  const html = input.html;
  const auth = ctx.apiKey ?? publicUploadAuth;
  const metadata = input.metadata ?? {};
  const draftId = input.draftId ?? newDraftId();
  if (
    input.draftId &&
    !ctx.db
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.account_id, auth.account_id),
          isNull(drafts.deleted_at),
        ),
      )
      .get()
  )
    throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  const versionId = randomUUID();
  const objectKey = `drafts/${draftId}/versions/${versionId}.html`;
  // Storage must finish before entering Bun SQLite's synchronous transaction.
  await ctx.putHtml(objectKey, html);
  return ctx.db.transaction(
    (tx) => {
      const [existing] = input.draftId
        ? tx
            .select()
            .from(drafts)
            .where(
              and(
                eq(drafts.id, input.draftId),
                eq(drafts.account_id, auth.account_id),
                isNull(drafts.deleted_at),
              ),
            )
            .limit(1)
            .all()
        : [];
      if (input.draftId && !existing)
        throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
      const [latest] = existing
        ? tx
            .select({ number: max(draftVersions.version_number) })
            .from(draftVersions)
            .where(eq(draftVersions.draft_id, draftId))
            .all()
        : [];
      const versionNumber = (latest?.number ?? 0) + 1;
      const title = validation.title || existing?.title || input.filename || "Untitled Draft";
      if (!existing)
        tx.insert(drafts)
          .values({
            id: draftId,
            account_id: auth.account_id,
            title,
            description: cleanText(input.description, 1000),
            repo_org: cleanText(metadata.repoOrg),
            repo_name: cleanText(metadata.repoName),
            repo_host: cleanText(metadata.repoHost),
          })
          .run();
      tx.insert(draftVersions)
        .values({
          id: versionId,
          draft_id: draftId,
          version_number: versionNumber,
          object_key: objectKey,
          content_hash: createHash("sha256").update(html).digest("hex"),
          file_size: Buffer.byteLength(html, "utf8"),
          created_by_api_key_id: auth.id,
          source_ip: ctx.sourceIp,
          user_agent: ctx.userAgent,
          request_id: ctx.requestId,
          cli_version: cleanText(metadata.cliVersion),
          git_branch: cleanText(metadata.gitBranch),
          git_commit_sha: cleanText(metadata.gitCommitSha),
          git_commit_subject: cleanText(metadata.gitCommitSubject),
          git_dirty: typeof metadata.gitDirty === "boolean" ? metadata.gitDirty : null,
          original_filename: cleanText(input.filename),
          has_inline_script: validation.stats.hasInlineScript,
          external_image_hosts: validation.stats.externalImageHosts,
          ci_run_url: cleanText(metadata.ciRunUrl),
          ci_actor: cleanText(metadata.ciActor),
        })
        .run();
      tx.update(drafts)
        .set({
          current_version_id: versionId,
          title,
          updated_at: new Date(),
          description: sql`coalesce(${cleanText(input.description, 1000)}, ${drafts.description})`,
          repo_org: sql`coalesce(${cleanText(metadata.repoOrg)}, ${drafts.repo_org})`,
          repo_name: sql`coalesce(${cleanText(metadata.repoName)}, ${drafts.repo_name})`,
          repo_host: sql`coalesce(${cleanText(metadata.repoHost)}, ${drafts.repo_host})`,
        })
        .where(eq(drafts.id, draftId))
        .run();
      tx.insert(uploadEvents)
        .values({
          id: randomUUID(),
          draft_id: draftId,
          draft_version_id: versionId,
          api_key_id: auth.id,
          event_type: existing ? "draft.updated" : "draft.created",
          source_ip: ctx.sourceIp,
          user_agent: ctx.userAgent,
          metadata_json: metadata,
        })
        .run();
      return {
        ok: true as const,
        draftId,
        versionId,
        versionNumber,
        title,
        requestId: ctx.requestId,
        ...urls(draftId, ctx),
        warnings: validation.warnings,
      };
    },
    { behavior: "immediate" },
  );
}
