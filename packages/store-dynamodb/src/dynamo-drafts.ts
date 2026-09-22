import { createHash, randomUUID } from "node:crypto";

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ORPCError } from "@orpc/server";
import { customAlphabet } from "nanoid";

import type { DraftRow, DraftVersionRow } from "@postplan/store";
import type { UploadContext } from "@postplan/store";
import { cleanText, matchesDraftSearch } from "@postplan/store";
import type { DraftStatus } from "@postplan/store";
import type { UploadInput } from "@postplan/store";
import { requireUploadAuth } from "@postplan/store";
import { validateHtml } from "@postplan/store/html-policy";
import { draftUrlBuilder, getDraftPublicUrl, getDraftRawUrl } from "@postplan/store/public-url";
import { expired } from "@postplan/store/retention";

import type { DynamoDatabase } from "./dynamo";
import { encode, optimistic, conditionalFailure } from "./dynamo";

export interface DynamoPlan extends DraftRow {
  draftId: string;
  state: "UPLOADING" | "ACTIVE" | "DELETING" | "DELETED";
  revision: number;
  lastUploadedAt: number;
  versionCount: number;
  deletionStartedAt?: number;
  ttlAt?: number;
}
export interface UploadIntent {
  draftId: string;
  sk: string;
  objectKey: string;
  status: "PENDING" | "COMMITTED" | "ABORTED";
  createdAt: Date;
  leaseUntil: number;
  versionNumber?: number;
  title?: string;
}
export interface DynamoVersion extends DraftVersionRow {
  sk: string;
}
interface UrlContext {
  publicBaseUrl?: string;
  requestBaseUrl: string;
}

const urls = (draftId: string, context: UrlContext) => ({
  publicUrl: getDraftPublicUrl({ draftId, ...context }),
  rawUrl: getDraftRawUrl({ draftId, ...context }),
});

export const versionKey = (number: number) => `VERSION#${String(number).padStart(16, "0")}`;
export function available(db: DynamoDatabase, plan: DynamoPlan | undefined): plan is DynamoPlan {
  return (
    !!plan &&
    plan.state === "ACTIVE" &&
    !plan.deletedAt &&
    !expired(plan.lastUploadedAt, db.retentionDays(), db.now())
  );
}
export function activeCondition(db: DynamoDatabase, plan: DynamoPlan) {
  return {
    ConditionExpression:
      "#state = :active AND revision = :revision AND accountId = :owner" +
      (db.retentionDays() > 0 ? " AND lastUploadedAt > :cutoff" : ""),
    ExpressionAttributeNames: { "#state": "state" },
    ExpressionAttributeValues: {
      ":active": "ACTIVE",
      ":revision": plan.revision,
      ":owner": plan.accountId,
      ...(db.retentionDays() > 0
        ? { ":cutoff": Math.floor(db.now() / 1000) - db.retentionDays() * 86400 }
        : {}),
    },
  };
}
const notFound = () => new ORPCError("NOT_FOUND", { message: "Draft not found." });

async function listAvailablePlans(db: DynamoDatabase, accountId: string) {
  const candidates = await db.query<DynamoPlan>({
    TableName: db.tables.plans,
    IndexName: "by-account",
    KeyConditionExpression: "accountId = :owner",
    ExpressionAttributeValues: { ":owner": accountId },
    ScanIndexForward: false,
  });
  const result = [];
  for (const candidate of candidates) {
    const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId: candidate.draftId });
    if (available(db, plan) && plan.accountId === accountId) {
      result.push(plan);
    }
  }
  return result;
}

export async function listDynamoDrafts(
  db: DynamoDatabase,
  input: {
    accountId: string;
    context: UrlContext;
    limit: number;
    after?: { updatedAt: Date; draftId: string } | undefined;
    q?: string | undefined;
    status: DraftStatus;
  },
) {
  const after = input.after;
  const matching = (await listAvailablePlans(db, input.accountId))
    .filter(
      (plan) =>
        (input.status === "all" || (input.status === "disabled") === !!plan.disabledAt) &&
        matchesDraftSearch(plan, input.q) &&
        (!after ||
          plan.updatedAt.getTime() < after.updatedAt.getTime() ||
          (plan.updatedAt.getTime() === after.updatedAt.getTime() && plan.draftId < after.draftId)),
    )
    .toSorted(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        (a.draftId < b.draftId ? 1 : a.draftId > b.draftId ? -1 : 0),
    );
  const urls = draftUrlBuilder(input.context);
  return {
    hasMore: matching.length > input.limit,
    drafts: matching.slice(0, input.limit).map((plan) => ({
      draftId: plan.draftId,
      title: plan.title,
      description: plan.description,
      repoOrg: plan.repoOrg,
      repoName: plan.repoName,
      repoHost: plan.repoHost,
      latestVersionNumber: plan.versionCount,
      latestVersionAt: new Date(plan.lastUploadedAt * 1000),
      versionCount: plan.versionCount,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      disabled: !!plan.disabledAt,
      ...urls(plan.draftId),
    })),
  };
}
export async function getDynamoDraftTotals(db: DynamoDatabase, accountId: string) {
  const plans = await listAvailablePlans(db, accountId);
  return {
    drafts: plans.length,
    published: plans.filter((plan) => !plan.disabledAt).length,
    versions: plans.reduce((sum, plan) => sum + plan.versionCount, 0),
  };
}
export async function getDynamoDraft(
  db: DynamoDatabase,
  accountId: string,
  draftId: string,
  context: UrlContext,
) {
  const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId });
  if (!available(db, plan) || plan.accountId !== accountId) {
    return null;
  }
  const versions = await db.query<DynamoVersion>({
    TableName: db.tables.records,
    ConsistentRead: true,
    ProjectionExpression:
      "id, versionNumber, createdAt, gitBranch, gitCommitSha, gitCommitSubject, gitDirty, fileSize",
    KeyConditionExpression: "draftId = :id AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: { ":id": draftId, ":prefix": "VERSION#" },
    ScanIndexForward: false,
  });
  if (!available(db, await db.get<DynamoPlan>(db.tables.plans, { draftId }))) {
    return null;
  }
  return {
    draft: {
      draftId,
      title: plan.title,
      description: plan.description,
      disabled: !!plan.disabledAt,
      ...urls(draftId, context),
    },
    versions: versions.map(
      ({
        id,
        versionNumber,
        createdAt,
        gitBranch,
        gitCommitSha,
        gitCommitSubject,
        gitDirty,
        fileSize,
      }) => ({
        id,
        versionNumber,
        createdAt,
        gitBranch,
        gitCommitSha,
        gitCommitSubject,
        gitDirty,
        fileSize,
      }),
    ),
  };
}
export async function findDynamoPublicVersion(
  db: DynamoDatabase,
  draftId: string,
  number?: number,
) {
  const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId });
  if (!available(db, plan) || plan.disabledAt) {
    return { draft: null, version: null };
  }
  const version = await db.get<DynamoVersion>(db.tables.records, {
    draftId,
    sk: versionKey(number ?? plan.versionCount),
  });
  return version ? { draft: plan, version } : { draft: null, version: null };
}
export type DraftUpdates = Partial<
  Pick<DraftRow, "title" | "description" | "disabledAt" | "disabledReason" | "deletedAt">
>;
export async function updateDynamoDraft(
  db: DynamoDatabase,
  accountId: string,
  draftId: string,
  values: DraftUpdates,
) {
  return optimistic(async () => {
    const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId });
    if (!available(db, plan) || plan.accountId !== accountId) {
      throw notFound();
    }
    const updated = {
      ...plan,
      ...values,
      updatedAt: new Date(db.now()),
      revision: plan.revision + 1,
      ...(values.deletedAt
        ? { state: "DELETING", deletionStartedAt: Math.floor(db.now() / 1000) }
        : {}),
    };
    await db.transact([
      { Put: { TableName: db.tables.plans, Item: encode(updated), ...activeCondition(db, plan) } },
    ]);
    return { ok: true as const };
  });
}

const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

export async function uploadDynamoDraft(
  db: DynamoDatabase,
  ctx: UploadContext,
  input: UploadInput,
) {
  const auth = requireUploadAuth(ctx.apiKey);
  const validation = validateHtml(input.html, { maxBytes: ctx.maxHtmlBytes });
  if (!validation.ok || typeof input.html !== "string") {
    return { ok: false as const, errors: validation.errors, warnings: validation.warnings };
  }
  const metadata = input.metadata ?? {};
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 32 * 1024) {
    throw new ORPCError("BAD_REQUEST", { message: "Upload metadata exceeds 32 KiB." });
  }
  const draftId = input.draftId ?? newId();
  const versionId = randomUUID();
  const objectKey = `drafts/${draftId}/versions/${versionId}.html`;
  const now = new Date(db.now());
  const intent: UploadIntent = {
    draftId,
    sk: `INTENT#${versionId}`,
    objectKey,
    status: "PENDING",
    createdAt: now,
    leaseUntil: Math.floor(db.now() / 1000) + 300,
  };
  const initial: DynamoPlan = {
    id: draftId,
    draftId,
    accountId: auth.accountId,
    state: "UPLOADING",
    revision: 0,
    lastUploadedAt: 0,
    versionCount: 0,
    title: cleanText(validation.title || input.filename) || "Untitled Draft",
    description: cleanText(input.description, 1000),
    currentVersionId: null,
    repoOrg: cleanText(metadata.repoOrg),
    repoName: cleanText(metadata.repoName),
    repoHost: cleanText(metadata.repoHost),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    disabledAt: null,
    disabledReason: null,
  };
  await optimistic(async () => {
    const plan = input.draftId ? await db.get<DynamoPlan>(db.tables.plans, { draftId }) : undefined;
    if (input.draftId && (!available(db, plan) || plan.accountId !== auth.accountId)) {
      throw notFound();
    }
    await db.transact([
      ...(plan
        ? [
            {
              ConditionCheck: {
                TableName: db.tables.plans,
                Key: { draftId },
                ...activeCondition(db, plan),
              },
            },
          ]
        : [
            {
              Put: {
                TableName: db.tables.plans,
                Item: encode(initial),
                ConditionExpression: "attribute_not_exists(draftId)",
              },
            },
          ]),
      {
        Put: {
          TableName: db.tables.records,
          Item: encode(intent),
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
    ]);
  });
  // Intents survive uncertain storage/transaction failures for reconciliation.
  await ctx.putHtml(objectKey, input.html);
  const html = input.html;
  const result = await optimistic(async () => {
    const persisted = await db.get<UploadIntent>(db.tables.records, { draftId, sk: intent.sk });
    if (persisted?.status === "COMMITTED" && persisted.versionNumber && persisted.title) {
      return { versionNumber: persisted.versionNumber, title: persisted.title };
    }
    if (!persisted || persisted.leaseUntil <= Math.floor(db.now() / 1000)) {
      throw notFound();
    }
    const plan = await db.get<DynamoPlan>(db.tables.plans, { draftId });
    if (
      !plan ||
      plan.accountId !== auth.accountId ||
      (input.draftId ? !available(db, plan) : plan.state !== "UPLOADING")
    ) {
      throw notFound();
    }
    const number = plan.versionCount + 1;
    const title = cleanText(validation.title || plan.title || input.filename) || "Untitled Draft";
    const timestamp = new Date(db.now());
    const version: DynamoVersion = {
      sk: versionKey(number),
      id: versionId,
      draftId,
      versionNumber: number,
      objectKey,
      contentHash: createHash("sha256").update(html).digest("hex"),
      fileSize: Buffer.byteLength(html, "utf8"),
      createdAt: timestamp,
      createdByApiKeyId: auth.id,
      sourceIp: cleanText(ctx.sourceIp),
      userAgent: cleanText(ctx.userAgent, 1000),
      requestId: cleanText(ctx.requestId),
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
    };
    const updated: DynamoPlan = {
      ...plan,
      state: "ACTIVE",
      revision: plan.revision + 1,
      versionCount: number,
      currentVersionId: versionId,
      title,
      updatedAt: timestamp,
      lastUploadedAt: Math.floor(timestamp.getTime() / 1000),
      description: cleanText(input.description, 1000) ?? plan.description,
      repoOrg: cleanText(metadata.repoOrg) ?? plan.repoOrg,
      repoName: cleanText(metadata.repoName) ?? plan.repoName,
      repoHost: cleanText(metadata.repoHost) ?? plan.repoHost,
    };
    // Bound all metadata before sending a transaction (DynamoDB items are limited to 400 KiB).
    if (Buffer.byteLength(JSON.stringify(version)) > 200 * 1024) {
      throw new ORPCError("BAD_REQUEST", { message: "Version metadata is too large." });
    }
    await db.transact([
      {
        Put: {
          TableName: db.tables.plans,
          Item: encode(updated),
          ...(input.draftId
            ? activeCondition(db, plan)
            : {
                ConditionExpression: "#state = :pending AND revision = :revision",
                ExpressionAttributeNames: { "#state": "state" },
                ExpressionAttributeValues: { ":pending": "UPLOADING", ":revision": 0 },
              }),
        },
      },
      {
        Put: {
          TableName: db.tables.records,
          Item: encode(version),
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
      {
        Put: {
          TableName: db.tables.records,
          Item: {
            draftId,
            sk: `EVENT#${versionId}`,
            versionId,
            apiKeyId: auth.id,
            eventType: number === 1 ? "draft.created" : "draft.updated",
            metadataJson: metadata,
            createdAt: timestamp.getTime(),
          },
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
      {
        Update: {
          TableName: db.tables.records,
          Key: { draftId, sk: intent.sk },
          UpdateExpression: "SET #status = :committed, versionNumber = :number, title = :title",
          ConditionExpression: "#status = :pending AND leaseUntil > :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":committed": "COMMITTED",
            ":pending": "PENDING",
            ":number": number,
            ":title": title,
            ":now": Math.floor(db.now() / 1000),
          },
        },
      },
    ]);
    return { versionNumber: number, title };
  });
  return {
    ok: true as const,
    draftId,
    versionId,
    ...result,
    requestId: ctx.requestId,
    ...urls(draftId, ctx),
    warnings: validation.warnings,
  };
}

export async function claimExpiredPlan(db: DynamoDatabase, plan: DynamoPlan): Promise<boolean> {
  const now = Math.floor(db.now() / 1000);
  const abandoned = plan.state === "UPLOADING" && plan.createdAt.getTime() / 1000 <= now - 86400;
  if (
    !abandoned &&
    (plan.state !== "ACTIVE" || !expired(plan.lastUploadedAt, db.retentionDays(), db.now()))
  ) {
    return false;
  }
  try {
    await db.client.send(
      new UpdateCommand({
        TableName: db.tables.plans,
        Key: { draftId: plan.draftId },
        UpdateExpression: "SET #state = :deleting, deletionStartedAt = :now, revision = :next",
        ConditionExpression:
          "#state = :previous AND revision = :revision AND lastUploadedAt = :uploaded",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: {
          ":deleting": "DELETING",
          ":now": now,
          ":next": plan.revision + 1,
          ":previous": plan.state,
          ":revision": plan.revision,
          ":uploaded": plan.lastUploadedAt,
        },
      }),
    );
    return true;
  } catch (error) {
    if (conditionalFailure(error)) {
      return false;
    }
    throw error;
  }
}
