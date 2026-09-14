import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const time = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const accounts = sqliteTable("accounts", {
  id: text().primaryKey(),
  name: text().notNull(),
  created_at: time("created_at").notNull().default(now),
  updated_at: time("updated_at").notNull().default(now),
});
export const apiKeys = sqliteTable("api_keys", {
  id: text().primaryKey(),
  account_id: text()
    .notNull()
    .references(() => accounts.id),
  name: text().notNull(),
  key_hash: text().notNull().unique("api_keys_key_hash_key"),
  created_at: time("created_at").notNull().default(now),
  last_used_at: time("last_used_at"),
  revoked_at: time("revoked_at"),
});
export const drafts = sqliteTable(
  "drafts",
  {
    id: text().primaryKey(),
    account_id: text()
      .notNull()
      .references(() => accounts.id),
    title: text().notNull(),
    description: text(),
    current_version_id: text(),
    repo_org: text(),
    repo_name: text(),
    repo_host: text(),
    created_at: time("created_at").notNull().default(now),
    updated_at: time("updated_at").notNull().default(now),
    deleted_at: time("deleted_at"),
    disabled_at: time("disabled_at"),
    disabled_reason: text(),
  },
  (table) => [index("drafts_account_id_idx").on(table.account_id)],
);
export const draftVersions = sqliteTable(
  "draft_versions",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => drafts.id),
    version_number: integer().notNull(),
    object_key: text().notNull(),
    content_hash: text().notNull(),
    file_size: integer().notNull(),
    created_at: time("created_at").notNull().default(now),
    created_by_api_key_id: text()
      .notNull()
      .references(() => apiKeys.id),
    source_ip: text(),
    user_agent: text(),
    cli_version: text(),
    git_branch: text(),
    git_commit_sha: text(),
    git_commit_subject: text(),
    git_dirty: integer({ mode: "boolean" }),
    original_filename: text(),
    request_id: text(),
    has_inline_script: integer({ mode: "boolean" }),
    external_image_hosts: text({ mode: "json" }).$type<string[]>(),
    ci_run_url: text(),
    ci_actor: text(),
  },
  (table) => [
    unique("draft_versions_draft_id_version_number_key").on(table.draft_id, table.version_number),
    index("draft_versions_draft_id_idx").on(table.draft_id),
  ],
);
export const uploadEvents = sqliteTable(
  "upload_events",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => drafts.id),
    draft_version_id: text().references(() => draftVersions.id),
    api_key_id: text()
      .notNull()
      .references(() => apiKeys.id),
    event_type: text().notNull(),
    source_ip: text(),
    user_agent: text(),
    metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_at: time("created_at").notNull().default(now),
  },
  (table) => [index("upload_events_draft_id_idx").on(table.draft_id)],
);
export const identities = sqliteTable(
  "identities",
  {
    id: text().primaryKey(),
    account_id: text()
      .notNull()
      .references(() => accounts.id),
    provider: text().notNull(),
    subject: text().notNull(),
    email: text(),
    email_verified: integer({ mode: "boolean" }),
    display_name: text(),
    picture_url: text(),
    pii_subject: text(),
    created_at: time("created_at").notNull().default(now),
    last_login_at: time("last_login_at"),
  },
  (table) => [unique("identities_provider_subject_key").on(table.provider, table.subject)],
);

export type DraftRow = typeof drafts.$inferSelect;
export type DraftVersionRow = typeof draftVersions.$inferSelect;
export type DraftVersionSummary = Pick<
  DraftVersionRow,
  | "id"
  | "version_number"
  | "created_at"
  | "git_branch"
  | "git_commit_sha"
  | "git_commit_subject"
  | "git_dirty"
  | "file_size"
>;
export type ApiKeySummary = Pick<
  typeof apiKeys.$inferSelect,
  "id" | "name" | "created_at" | "last_used_at"
>;
