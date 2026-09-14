import { createHash, randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { drafts, draftVersions, uploadEvents } from "../db/schema.js";
import { publicUploadAuth } from "./account-store.js";
import type { Database } from "../db/client.js";
import { validateHtml } from "../lib/html-policy.js";
import { getDraftPublicUrl, getDraftRawUrl } from "../lib/public-url.js";
import type { ApiContext } from "../context.js";

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
    .select({ draftId: draftVersions.draftId, versionCount: count().as("version_count") })
    .from(draftVersions)
    .groupBy(draftVersions.draftId)
    .as("version_counts");
  const rows = await db
    .select({
      draft: drafts,
      latest: { number: draftVersions.versionNumber, date: draftVersions.createdAt },
      count: counts.versionCount,
    })
    .from(drafts)
    .leftJoin(draftVersions, eq(draftVersions.id, drafts.currentVersionId))
    .leftJoin(counts, eq(counts.draftId, drafts.id))
    .where(and(eq(drafts.accountId, accountId), isNull(drafts.deletedAt)))
    .orderBy(desc(drafts.updatedAt));
  return rows.map(({ draft, latest, count: versionCount }) => ({
    draftId: draft.id,
    title: draft.title,
    description: draft.description,
    repoOrg: draft.repoOrg,
    repoName: draft.repoName,
    repoHost: draft.repoHost,
    latestVersionNumber: latest?.number ?? null,
    latestVersionAt: latest?.date ?? null,
    versionCount: Number(versionCount ?? 0),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    disabled: Boolean(draft.disabledAt),
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
    .where(and(eq(drafts.id, draftId), eq(drafts.accountId, accountId), isNull(drafts.deletedAt)))
    .limit(1);
  if (!draft) return null;
  const versions = await db
    .select({
      id: draftVersions.id,
      versionNumber: draftVersions.versionNumber,
      createdAt: draftVersions.createdAt,
      gitBranch: draftVersions.gitBranch,
      gitCommitSha: draftVersions.gitCommitSha,
      gitCommitSubject: draftVersions.gitCommitSubject,
      gitDirty: draftVersions.gitDirty,
      fileSize: draftVersions.fileSize,
    })
    .from(draftVersions)
    .where(eq(draftVersions.draftId, draftId))
    .orderBy(desc(draftVersions.versionNumber));
  return {
    draft: {
      draftId,
      title: draft.title,
      description: draft.description,
      disabled: Boolean(draft.disabledAt),
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
        eq(draftVersions.draftId, drafts.id),
        versionNumber === undefined
          ? eq(draftVersions.id, drafts.currentVersionId)
          : eq(draftVersions.versionNumber, versionNumber),
      ),
    )
    .where(and(eq(drafts.id, draftId), isNull(drafts.deletedAt), isNull(drafts.disabledAt)))
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
      "title" | "description" | "disabledAt" | "disabledReason" | "deletedAt"
    >
  >,
) {
  const [draft] = await db
    .update(drafts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(drafts.id, draftId), eq(drafts.accountId, accountId), isNull(drafts.deletedAt)))
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
        and(eq(drafts.id, draftId), eq(drafts.accountId, auth.accountId), isNull(drafts.deletedAt)),
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
                eq(drafts.accountId, auth.accountId),
                isNull(drafts.deletedAt),
              ),
            )
            .limit(1)
            .all()
        : [];
      if (input.draftId && !existing)
        throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
      const [latest] = existing
        ? tx
            .select({ number: max(draftVersions.versionNumber) })
            .from(draftVersions)
            .where(eq(draftVersions.draftId, draftId))
            .all()
        : [];
      const versionNumber = (latest?.number ?? 0) + 1;
      const title = validation.title || existing?.title || input.filename || "Untitled Draft";
      if (!existing)
        tx.insert(drafts)
          .values({
            id: draftId,
            accountId: auth.accountId,
            title,
            description: cleanText(input.description, 1000),
            repoOrg: cleanText(metadata.repoOrg),
            repoName: cleanText(metadata.repoName),
            repoHost: cleanText(metadata.repoHost),
          })
          .run();
      tx.insert(draftVersions)
        .values({
          id: versionId,
          draftId: draftId,
          versionNumber: versionNumber,
          objectKey: objectKey,
          contentHash: createHash("sha256").update(html).digest("hex"),
          fileSize: Buffer.byteLength(html, "utf8"),
          createdByApiKeyId: auth.id,
          sourceIp: ctx.sourceIp,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          cliVersion: cleanText(metadata.cliVersion),
          gitBranch: cleanText(metadata.gitBranch),
          gitCommitSha: cleanText(metadata.gitCommitSha),
          gitCommitSubject: cleanText(metadata.gitCommitSubject),
          gitDirty: typeof metadata.gitDirty === "boolean" ? metadata.gitDirty : null,
          originalFilename: cleanText(input.filename),
          hasInlineScript: validation.stats.hasInlineScript,
          externalImageHosts: validation.stats.externalImageHosts,
          ciRunUrl: cleanText(metadata.ciRunUrl),
          ciActor: cleanText(metadata.ciActor),
        })
        .run();
      tx.update(drafts)
        .set({
          currentVersionId: versionId,
          title,
          updatedAt: new Date(),
          description: sql`coalesce(${cleanText(input.description, 1000)}, ${drafts.description})`,
          repoOrg: sql`coalesce(${cleanText(metadata.repoOrg)}, ${drafts.repoOrg})`,
          repoName: sql`coalesce(${cleanText(metadata.repoName)}, ${drafts.repoName})`,
          repoHost: sql`coalesce(${cleanText(metadata.repoHost)}, ${drafts.repoHost})`,
        })
        .where(eq(drafts.id, draftId))
        .run();
      tx.insert(uploadEvents)
        .values({
          id: randomUUID(),
          draftId: draftId,
          draftVersionId: versionId,
          apiKeyId: auth.id,
          eventType: existing ? "draft.updated" : "draft.created",
          sourceIp: ctx.sourceIp,
          userAgent: ctx.userAgent,
          metadataJson: metadata,
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
