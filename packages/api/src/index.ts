import { openapi } from "@orpc/openapi";
import { oc } from "@orpc/contract";
import type { RouterContractClient } from "@orpc/contract";
import { z } from "zod";

const nullableText = z.string().nullable();
export const uploadRejected = z.object({
  ok: z.literal(false),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
const uploadSuccess = z.object({
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
const ok = z.object({ ok: z.literal(true) });
const draftId = z.object({ draftId: z.string().min(1).max(255) });
const draftSummary = z.object({
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
      version_number: z.number(),
      created_at: z.date(),
      git_branch: nullableText,
      git_commit_sha: nullableText,
      git_commit_subject: nullableText,
      git_dirty: z.boolean().nullable(),
      file_size: z.number(),
    }),
  ),
});
export const apiKeySummary = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.date(),
  last_used_at: z.date().nullable(),
});

// HTTP routes and schemas are defined here; database access belongs to apps/server.
export const contract = {
  account: {
    me: oc.meta(openapi({ method: "GET", path: "/me" })).output(
      z.object({
        accountId: z.string(),
        accountName: z.string(),
        apiKeyId: nullableText,
        apiKeyName: nullableText,
      }),
    ),
  },
  drafts: {
    list: oc
      .meta(openapi({ method: "GET", path: "/drafts" }))
      .output(ok.extend({ drafts: z.array(accountDraft) })),
    detail: oc
      .meta(openapi({ method: "GET", path: "/drafts/{draftId}" }))
      .input(draftId)
      .output(draftDetail),
    update: oc
      .meta(openapi({ method: "PATCH", path: "/drafts/{draftId}" }))
      .input(
        draftId.extend({
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().trim().max(1000).nullable().optional(),
        }),
      )
      .output(ok),
    delete: oc
      .meta(openapi({ method: "DELETE", path: "/drafts/{draftId}" }))
      .input(draftId)
      .output(ok),
    disable: oc
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/disable" }))
      .input(draftId.extend({ reason: z.string().max(255).optional() }))
      .output(ok),
    enable: oc
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/enable" }))
      .input(draftId)
      .output(ok),
    upload: oc
      .meta(openapi({ method: "POST", path: "/uploads", outputStructure: "detailed" }))
      .errors({ UNPROCESSABLE_ENTITY: { data: uploadRejected } })
      .input(
        z.object({
          html: z.unknown().optional(),
          filename: z.string().optional(),
          draftId: z
            .string()
            .min(1)
            .nullish()
            .transform((value) => value ?? undefined),
          description: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal(201), body: uploadSuccess }),
          z.object({ status: z.literal(200), body: uploadSuccess }),
        ]),
      ),
  },
  apiKeys: {
    list: oc.meta(openapi({ method: "GET", path: "/api-keys" })).output(z.array(apiKeySummary)),
    create: oc
      .meta(openapi({ method: "POST", path: "/api-keys", successStatus: 201 }))
      .input(z.object({ name: z.string().trim().max(255).optional() }))
      .output(
        ok.extend({ apiKey: z.object({ id: z.string(), name: z.string() }), token: z.string() }),
      ),
    revoke: oc
      .meta(openapi({ method: "POST", path: "/api-keys/{apiKeyId}/revoke" }))
      .input(z.object({ apiKeyId: z.string().min(1) }))
      .output(ok),
  },
};
export type ApiClient = RouterContractClient<typeof contract>;
export type AccountDraft = z.infer<typeof accountDraft>;
export type AccountDraftDetail = z.infer<typeof draftDetail>;
export type ApiKeySummary = z.infer<typeof apiKeySummary>;
