import { z } from "zod";

const nullableText = z.string().nullable();
export const draft = z.object({
  id: z.string(),
  accountId: z.string(),
  title: z.string(),
  description: nullableText,
  currentVersionId: nullableText,
  repoOrg: nullableText,
  repoName: nullableText,
  repoHost: nullableText,
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
  disabledAt: z.date().nullable(),
  disabledReason: nullableText,
});
export const draftVersion = z.object({
  id: z.string(),
  draftId: z.string(),
  versionNumber: z.number(),
  objectKey: z.string(),
  contentHash: z.string(),
  fileSize: z.number(),
  createdAt: z.date(),
  createdByApiKeyId: z.string(),
  sourceIp: nullableText,
  userAgent: nullableText,
  cliVersion: nullableText,
  gitBranch: nullableText,
  gitCommitSha: nullableText,
  gitCommitSubject: nullableText,
  gitDirty: z.boolean().nullable(),
  originalFilename: nullableText,
  requestId: nullableText,
  hasInlineScript: z.boolean().nullable(),
  externalImageHosts: z.array(z.string()).nullable(),
  ciRunUrl: nullableText,
  ciActor: nullableText,
});
export const apiKeyAuth = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string(),
  accountName: z.string(),
});
export const identityInput = z.object({
  provider: z.string(),
  subject: z.string(),
  profile: z
    .object({
      email: nullableText.optional(),
      emailVerified: z.boolean().nullish(),
      displayName: nullableText.optional(),
      pictureUrl: nullableText.optional(),
      piiSubject: nullableText.optional(),
    })
    .optional(),
});
export const identityAccount = z.object({
  accountId: z.string(),
  accountName: z.string(),
  email: nullableText,
  pictureUrl: nullableText,
});
export const draftUpdates = draft
  .pick({ title: true, description: true, disabledAt: true, disabledReason: true, deletedAt: true })
  .partial();
export const urlContext = z.object({
  publicBaseUrl: z.string().optional(),
  requestBaseUrl: z.string(),
});
export type DraftRow = z.infer<typeof draft>;
export type DraftVersionRow = z.infer<typeof draftVersion>;
export type ApiKeyAuth = z.infer<typeof apiKeyAuth>;
export type IdentityInput = z.infer<typeof identityInput>;
export type IdentityProfile = NonNullable<IdentityInput["profile"]>;
export type IdentityAccount = z.infer<typeof identityAccount>;
export type DraftUpdates = z.infer<typeof draftUpdates>;
export type UrlContext = z.infer<typeof urlContext>;

export interface UploadContext extends UrlContext {
  apiKey: ApiKeyAuth | null;
  sourceIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  maxHtmlBytes: number;
  putHtml: (key: string, html: string) => Promise<void>;
}
export interface UploadInput {
  html?: unknown;
  filename?: string;
  draftId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
export const publicUploadAuth: ApiKeyAuth = {
  id: "key_public_upload",
  name: "Public Uploads",
  accountId: "acct_public_upload",
  accountName: "Public Uploads",
};
export interface RateLimitConfig {
  window: number;
  maxRequests: number;
}
