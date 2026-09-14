import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const time = () => integer({ mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const accounts = sqliteTable("accounts", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: time().notNull().default(now),
  updatedAt: time().notNull().default(now),
});
export const apiKeys = sqliteTable("api_keys", {
  id: text().primaryKey(),
  accountId: text()
    .notNull()
    .references(() => accounts.id),
  name: text().notNull(),
  keyHash: text().notNull().unique("api_keys_key_hash_key"),
  createdAt: time().notNull().default(now),
  lastUsedAt: time(),
  revokedAt: time(),
});
export const drafts = sqliteTable(
  "drafts",
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    title: text().notNull(),
    description: text(),
    currentVersionId: text(),
    repoOrg: text(),
    repoName: text(),
    repoHost: text(),
    createdAt: time().notNull().default(now),
    updatedAt: time().notNull().default(now),
    deletedAt: time(),
    disabledAt: time(),
    disabledReason: text(),
  },
  (table) => [index("drafts_account_id_idx").on(table.accountId)],
);
export const draftVersions = sqliteTable(
  "draft_versions",
  {
    id: text().primaryKey(),
    draftId: text()
      .notNull()
      .references(() => drafts.id),
    versionNumber: integer().notNull(),
    objectKey: text().notNull(),
    contentHash: text().notNull(),
    fileSize: integer().notNull(),
    createdAt: time().notNull().default(now),
    createdByApiKeyId: text()
      .notNull()
      .references(() => apiKeys.id),
    sourceIp: text(),
    userAgent: text(),
    cliVersion: text(),
    gitBranch: text(),
    gitCommitSha: text(),
    gitCommitSubject: text(),
    gitDirty: integer({ mode: "boolean" }),
    originalFilename: text(),
    requestId: text(),
    hasInlineScript: integer({ mode: "boolean" }),
    externalImageHosts: text({ mode: "json" }).$type<string[]>(),
    ciRunUrl: text(),
    ciActor: text(),
  },
  (table) => [
    unique("draft_versions_draft_id_version_number_key").on(table.draftId, table.versionNumber),
    index("draft_versions_draft_id_idx").on(table.draftId),
  ],
);
export const uploadEvents = sqliteTable(
  "upload_events",
  {
    id: text().primaryKey(),
    draftId: text()
      .notNull()
      .references(() => drafts.id),
    draftVersionId: text().references(() => draftVersions.id),
    apiKeyId: text()
      .notNull()
      .references(() => apiKeys.id),
    eventType: text().notNull(),
    sourceIp: text(),
    userAgent: text(),
    metadataJson: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: time().notNull().default(now),
  },
  (table) => [index("upload_events_draft_id_idx").on(table.draftId)],
);
export const identities = sqliteTable(
  "identities",
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    provider: text().notNull(),
    subject: text().notNull(),
    email: text(),
    emailVerified: integer({ mode: "boolean" }),
    displayName: text(),
    pictureUrl: text(),
    piiSubject: text(),
    createdAt: time().notNull().default(now),
    lastLoginAt: time(),
  },
  (table) => [unique("identities_provider_subject_key").on(table.provider, table.subject)],
);

export type DraftRow = typeof drafts.$inferSelect;
export type DraftVersionRow = typeof draftVersions.$inferSelect;
export type DraftVersionSummary = Pick<
  DraftVersionRow,
  | "id"
  | "versionNumber"
  | "createdAt"
  | "gitBranch"
  | "gitCommitSha"
  | "gitCommitSubject"
  | "gitDirty"
  | "fileSize"
>;
export type ApiKeySummary = Pick<
  typeof apiKeys.$inferSelect,
  "id" | "name" | "createdAt" | "lastUsedAt"
>;
