import { prepared, statement } from "./database";
import { createHash, randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { drafts, draftVersions, uploadEvents } from "./schema";
import { publicUploadAuth } from "@postplan/store";
import type { Database } from "./database";
import { validateHtml } from "@postplan/store/html-policy";
import { getDraftPublicUrl, getDraftRawUrl } from "@postplan/store/public-url";
import type { UploadContext, UploadInput } from "@postplan/store";

const newDraftId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);
import { cleanText } from "@postplan/store/text";
import type { UrlContext } from "@postplan/store";
const urls = (draftId: string, context: UrlContext) => ({
  publicUrl: getDraftPublicUrl({ draftId, ...context }),
  rawUrl: getDraftRawUrl({ draftId, ...context }),
});

const accountDraftsQuery = prepared((db) => {
  const counts = db
    .select({ draftId: draftVersions.draftId, versionCount: count().as("version_count") })
    .from(draftVersions)
    .groupBy(draftVersions.draftId)
    .as("version_counts");
  return db
    .select({
      draft: drafts,
      latest: { number: draftVersions.versionNumber, date: draftVersions.createdAt },
      count: counts.versionCount,
    })
    .from(drafts)
    .leftJoin(draftVersions, eq(draftVersions.id, drafts.currentVersionId))
    .leftJoin(counts, eq(counts.draftId, drafts.id))
    .where(and(eq(drafts.accountId, sql.placeholder("accountId")), isNull(drafts.deletedAt)))
    .orderBy(desc(drafts.updatedAt))
    .prepare();
});

export async function listAccountDrafts(db: Database, accountId: string, context: UrlContext) {
  const rows = await accountDraftsQuery(db).all({ accountId });
  return rows.map(({ draft, latest, count: versionCount }) => ({
    draftId: draft.id,
    title: draft.title,
    description: draft.description,
    repoOrg: draft.repoOrg,
    repoName: draft.repoName,
    repoHost: draft.repoHost,
    latestVersionNumber: latest?.number ?? null,
    latestVersionAt: latest?.date ?? null,
    versionCount: versionCount ?? 0,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    disabled: Boolean(draft.disabledAt),
    ...urls(draft.id, context),
  }));
}
export type AccountDraft = Awaited<ReturnType<typeof listAccountDrafts>>[number];

const ownedDraftQuery = prepared((db) =>
  db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.id, sql.placeholder("draftId")),
        eq(drafts.accountId, sql.placeholder("accountId")),
        isNull(drafts.deletedAt),
      ),
    )
    .limit(1)
    .prepare(),
);
const draftVersionsQuery = prepared((db) =>
  db
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
    .where(eq(draftVersions.draftId, sql.placeholder("draftId")))
    .orderBy(desc(draftVersions.versionNumber))
    .prepare(),
);

export async function getAccountDraftWithVersions(
  db: Database,
  accountId: string,
  draftId: string,
  context: UrlContext,
) {
  const draft = await ownedDraftQuery(db).get({ draftId, accountId });
  if (!draft) {
    return null;
  }
  const versions = await draftVersionsQuery(db).all({ draftId });
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

const publicVersionQuery = (version: "current" | "numbered") =>
  prepared((db) =>
    db
      .select({ draft: drafts, version: draftVersions })
      .from(drafts)
      .innerJoin(
        draftVersions,
        and(
          eq(draftVersions.draftId, drafts.id),
          version === "current"
            ? eq(draftVersions.id, drafts.currentVersionId)
            : eq(draftVersions.versionNumber, sql.placeholder("versionNumber")),
        ),
      )
      .where(
        and(
          eq(drafts.id, sql.placeholder("draftId")),
          isNull(drafts.deletedAt),
          isNull(drafts.disabledAt),
        ),
      )
      .limit(1)
      .prepare(),
  );
const currentPublicVersionQuery = publicVersionQuery("current");
const numberedPublicVersionQuery = publicVersionQuery("numbered");

export async function findPublicDraftVersion(
  db: Database,
  draftId: string,
  versionNumber?: number,
) {
  const row =
    versionNumber === undefined
      ? await currentPublicVersionQuery(db).get({ draftId })
      : await numberedPublicVersionQuery(db).get({ draftId, versionNumber });
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
  if (!draft) {
    throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  }
  return { ok: true as const };
}

const ownedDraftIdQuery = prepared((db) =>
  db
    .select({ id: drafts.id })
    .from(drafts)
    .where(
      and(
        eq(drafts.id, sql.placeholder("draftId")),
        eq(drafts.accountId, sql.placeholder("accountId")),
        isNull(drafts.deletedAt),
      ),
    )
    .prepare(),
);
const versionNumberQuery = prepared((db) =>
  db
    .select({ versionNumber: draftVersions.versionNumber })
    .from(draftVersions)
    .where(eq(draftVersions.id, sql.placeholder("versionId")))
    .prepare(),
);
const draftTitleQuery = prepared((db) =>
  db
    .select({ title: drafts.title })
    .from(drafts)
    .where(eq(drafts.id, sql.placeholder("draftId")))
    .prepare(),
);

export async function uploadDraft(db: Database, ctx: UploadContext, input: UploadInput) {
  const validation = validateHtml(input.html, { maxBytes: ctx.maxHtmlBytes });
  if (!validation.ok || typeof input.html !== "string") {
    return { ok: false as const, errors: validation.errors, warnings: validation.warnings };
  }
  const html = input.html;
  const auth = ctx.apiKey ?? publicUploadAuth;
  const metadata = input.metadata ?? {};
  const draftId = input.draftId ?? newDraftId();
  if (input.draftId && !(await ownedDraftIdQuery(db).get({ draftId, accountId: auth.accountId }))) {
    throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
  }
  const versionId = randomUUID();
  const objectKey = `drafts/${draftId}/versions/${versionId}.html`;
  // External object storage completes before the atomic metadata write.
  await ctx.putHtml(objectKey, html);
  const owned = and(
    eq(drafts.id, draftId),
    eq(drafts.accountId, auth.accountId),
    isNull(drafts.deletedAt),
  );
  const title = validation.title || input.filename || "Untitled Draft";
  const statements = [];
  if (!input.draftId) {
    statements.push(
      statement(
        db.insert(drafts).values({
          id: draftId,
          accountId: auth.accountId,
          title,
          description: cleanText(input.description, 1000),
          repoOrg: cleanText(metadata.repoOrg),
          repoName: cleanText(metadata.repoName),
          repoHost: cleanText(metadata.repoHost),
        }),
      ),
    );
  }
  // A missing owner/deleted draft produces NULL, violating NOT NULL and rolling
  // back the whole batch. Version allocation happens inside the same transaction.
  statements.push(
    statement(
      db.insert(draftVersions).values({
        id: versionId,
        draftId: sql`(${db.select({ id: drafts.id }).from(drafts).where(owned)})`,
        versionNumber: sql`coalesce((${db
          .select({ n: max(draftVersions.versionNumber) })
          .from(draftVersions)
          .where(eq(draftVersions.draftId, draftId))}), 0) + 1`,
        objectKey,
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
      }),
    ),
  );
  statements.push(
    statement(
      db
        .update(drafts)
        .set({
          currentVersionId: versionId,
          title: validation.title || sql`coalesce(nullif(${drafts.title}, ''), ${title})`,
          updatedAt: new Date(),
          description: sql`coalesce(${cleanText(input.description, 1000)}, ${drafts.description})`,
          repoOrg: sql`coalesce(${cleanText(metadata.repoOrg)}, ${drafts.repoOrg})`,
          repoName: sql`coalesce(${cleanText(metadata.repoName)}, ${drafts.repoName})`,
          repoHost: sql`coalesce(${cleanText(metadata.repoHost)}, ${drafts.repoHost})`,
        })
        .where(owned),
    ),
  );
  statements.push(
    statement(
      db.insert(uploadEvents).values({
        id: randomUUID(),
        draftId,
        draftVersionId: versionId,
        apiKeyId: auth.id,
        eventType: input.draftId ? "draft.updated" : "draft.created",
        sourceIp: ctx.sourceIp,
        userAgent: ctx.userAgent,
        metadataJson: metadata,
      }),
    ),
  );
  try {
    await db.atomic(statements);
  } catch (error) {
    if (
      input.draftId &&
      !(await ownedDraftIdQuery(db).get({ draftId, accountId: auth.accountId }))
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Draft not found." });
    }
    throw error;
  }
  const version = await versionNumberQuery(db).get({ versionId });
  const draft = await draftTitleQuery(db).get({ draftId });
  if (!version || !draft) {
    throw new Error("Draft missing after atomic upload");
  }
  return {
    ok: true as const,
    draftId,
    versionId,
    versionNumber: version.versionNumber,
    title: validation.title || draft.title,
    requestId: ctx.requestId,
    ...urls(draftId, ctx),
    warnings: validation.warnings,
  };
}
