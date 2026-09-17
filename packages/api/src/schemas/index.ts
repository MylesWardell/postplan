import { z } from "zod";

export const nullableText = z.string().nullable();
export const uploadRejected = z.object({
  ok: z.literal(false),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
export const uploadSuccess = z.object({
  ok: z.literal(true),
  draftId: z.string(),
  versionId: z.string(),
  versionNumber: z.number(),
  title: z.string(),
  requestId: nullableText,
  publicUrl: z.string(),
  rawUrl: z.string(),
  warnings: z.array(z.string()),
});
export const ok = z.object({ ok: z.literal(true) });
export const draftId = z.object({ draftId: z.string().min(1).max(255) });
export const draftSummary = z.object({
  draftId: z.string(),
  title: z.string(),
  description: nullableText,
  publicUrl: z.string(),
  rawUrl: z.string(),
  disabled: z.boolean(),
});
export const accountDraft = draftSummary.extend({
  repoOrg: nullableText,
  repoName: nullableText,
  repoHost: nullableText,
  latestVersionNumber: z.number().nullable(),
  latestVersionAt: z.date().nullable(),
  versionCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const draftDetail = z.object({
  draft: draftSummary,
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number(),
      createdAt: z.date(),
      gitBranch: nullableText,
      gitCommitSha: nullableText,
      gitCommitSubject: nullableText,
      gitDirty: z.boolean().nullable(),
      fileSize: z.number(),
    }),
  ),
});
export const apiKeySummary = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

export type AccountDraft = z.infer<typeof accountDraft>;
export type AccountDraftDetail = z.infer<typeof draftDetail>;
export type ApiKeySummary = z.infer<typeof apiKeySummary>;
export type DraftStatus = z.infer<typeof draftStatus>;
export type DraftTotals = z.infer<typeof draftTotals>;

export const account = z.object({
  accountId: z.string(),
  accountName: z.string(),
  apiKeyId: nullableText,
  apiKeyName: nullableText,
});
export const DRAFT_PAGE_SIZE_DEFAULT = 50;
export const DRAFT_PAGE_SIZE_MAX = 100;
export const draftStatus = z.enum(["all", "published", "disabled"]);
// prefault keeps `drafts.list()` valid while still applying the field defaults.
export const listDraftsInput = z
  .object({
    limit: z.number().int().min(1).max(DRAFT_PAGE_SIZE_MAX).default(DRAFT_PAGE_SIZE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
    q: z.string().trim().max(255).optional(),
    status: draftStatus.default("all"),
  })
  .prefault({});
export const draftList = ok.extend({ drafts: z.array(accountDraft), nextCursor: nullableText });
export const draftTotals = z.object({
  drafts: z.number(),
  published: z.number(),
  versions: z.number(),
});
export const updateDraftInput = draftId.extend({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});
export const disableDraftInput = draftId.extend({ reason: z.string().max(255).optional() });
export const uploadInput = z.object({
  html: z.unknown().optional(),
  filename: z.string().optional(),
  draftId: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const uploadOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal(201), body: uploadSuccess }),
  z.object({ status: z.literal(200), body: uploadSuccess }),
]);
export const apiKeyList = z.array(apiKeySummary);
export const createApiKeyInput = z.object({ name: z.string().trim().max(255).optional() });
export const createdApiKey = ok.extend({
  apiKey: z.object({ id: z.string(), name: z.string() }),
  token: z.string(),
});
export const revokeApiKeyInput = z.object({ apiKeyId: z.string().min(1) });
