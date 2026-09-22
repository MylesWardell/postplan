import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import { requireUploadAuth } from "@postplan/store";
import type { UploadContext, UploadInput } from "@postplan/store";
import type { DraftStatus } from "@postplan/store";
import type { UrlContext } from "@postplan/store";
import { validateHtml } from "@postplan/store/html-policy";
import { draftUrlBuilder, getDraftPublicUrl, getDraftRawUrl } from "@postplan/store/public-url";
import { cleanText } from "@postplan/store/text";

import { prepared, statement } from "./database";
import type { Database } from "./database";
import { drafts, draftVersions, uploadEvents } from "./schema";

const newDraftId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

const urls = (draftId: string, context: UrlContext) => ({
  publicUrl: getDraftPublicUrl({ draftId, ...context }),
  rawUrl: getDraftRawUrl({ draftId, ...context }),
});

// A correlated count uses the draft_id index instead of grouping every account's versions.
const versionCount = sql<number>`(select count(*) from ${draftVersions} where ${draftVersions.draftId} = ${drafts.id})`;
const accountDraftsQuery = prepared((db) =>
  db
    .select({
      draft: {
        id: drafts.id,
        title: drafts.title,
        description: drafts.description,
        repoOrg: drafts.repoOrg,
        repoName: drafts.repoName,
        repoHost: drafts.repoHost,
        createdAt: drafts.createdAt,
        updatedAt: drafts.updatedAt,
        disabledAt: drafts.disabledAt,
      },
      latest: { number: draftVersions.versionNumber, date: draftVersions.createdAt },
      count: versionCount,
    })
    .from(drafts)
    .leftJoin(draftVersions, eq(draftVersions.id, drafts.currentVersionId))
    .where(
      and(
        eq(drafts.accountId, sql.placeholder("accountId")),
        isNull(drafts.deletedAt),
        sql`(${sql.placeholder("status")} <> 'published' or ${drafts.disabledAt} is null)`,
        sql`(${sql.placeholder("status")} <> 'disabled' or ${drafts.disabledAt} is not null)`,
        sql`(${sql.placeholder("q")} = '' or instr(lower(${drafts.title} || ' ' || coalesce(${drafts.description}, '') || ' ' || coalesce(${drafts.repoName}, '')), lower(${sql.placeholder("q")})) > 0)`,
        sql`(${sql.placeholder("afterUpdatedAt")} is null or ${drafts.updatedAt} < ${sql.placeholder("afterUpdatedAt")} or (${drafts.updatedAt} = ${sql.placeholder("afterUpdatedAt")} and ${drafts.id} < ${sql.placeholder("afterDraftId")}))`,
      ),
    )
    .orderBy(desc(drafts.updatedAt), desc(drafts.id))
    .limit(sql.placeholder("limit"))
    .prepare(),
);

export async function listAccountDrafts(
  db: Database,
  input: {
    accountId: string;
    context: UrlContext;
    limit: number;
    after?: { updatedAt: Date; draftId: string } | undefined;
    q?: string | undefined;
    status: DraftStatus;
  },
) {
  const rows = await accountDraftsQuery(db).all({
    accountId: input.accountId,
    status: input.status,
    q: input.q ?? "",
    afterUpdatedAt: input.after?.updatedAt.getTime() ?? null,
    afterDraftId: input.after?.draftId ?? "",
    limit: input.limit + 1,
  });
  const urls = draftUrlBuilder(input.context);
  return {
    hasMore: rows.length > input.limit,
    drafts: rows.slice(0, input.limit).map(({ draft, latest, count: versions }) => ({
      draftId: draft.id,
      title: draft.title,
      description: draft.description,
      repoOrg: draft.repoOrg,
      repoName: draft.repoName,
      repoHost: draft.repoHost,
      latestVersionNumber: latest?.number ?? null,
      latestVersionAt: latest?.date ?? null,
      versionCount: versions ?? 0,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      disabled: Boolean(draft.disabledAt),
      ...urls(draft.id),
    })),
  };
}

const accountTotalsQuery = prepared((db) =>
  db
    .select({
      drafts: sql<number>`count(*)`,
      published: sql<number>`coalesce(sum(${drafts.disabledAt} is null), 0)`,
      versions: sql<number>`coalesce(sum(${versionCount}), 0)`,
    })
    .from(drafts)
    .where(and(eq(drafts.accountId, sql.placeholder("accountId")), isNull(drafts.deletedAt)))
    .prepare(),
);

export async function getAccountDraftTotals(db: Database, accountId: string) {
  const totals = await accountTotalsQuery(db).get({ accountId });
  return {
    drafts: Number(totals?.drafts ?? 0),
    published: Number(totals?.published ?? 0),
    versions: Number(totals?.versions ?? 0),
  };
}
export type AccountDraft = Awaited<ReturnType<typeof listAccountDrafts>>["drafts"][number];

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
  const auth = requireUploadAuth(ctx.apiKey);
  const validation = validateHtml(input.html, { maxBytes: ctx.maxHtmlBytes });
  if (!validation.ok || typeof input.html !== "string") {
    return { ok: false as const, errors: validation.errors, warnings: validation.warnings };
  }
  const html = input.html;
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
