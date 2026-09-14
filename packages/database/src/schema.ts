import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const accounts = pgTable("accounts", {
  id: text().primaryKey(),
  name: text().notNull(),
  created_at: time("created_at").notNull().defaultNow(),
  updated_at: time("updated_at").notNull().defaultNow(),
});
export const apiKeys = pgTable("api_keys", {
  id: text().primaryKey(),
  account_id: text()
    .notNull()
    .references(() => accounts.id),
  name: text().notNull(),
  key_hash: text().notNull().unique("api_keys_key_hash_key"),
  created_at: time("created_at").notNull().defaultNow(),
  last_used_at: time("last_used_at"),
  revoked_at: time("revoked_at"),
});
export const drafts = pgTable(
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
    created_at: time("created_at").notNull().defaultNow(),
    updated_at: time("updated_at").notNull().defaultNow(),
    deleted_at: time("deleted_at"),
    disabled_at: time("disabled_at"),
    disabled_reason: text(),
  },
  (table) => [index("drafts_account_id_idx").on(table.account_id)],
);
export const draftVersions = pgTable(
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
    created_at: time("created_at").notNull().defaultNow(),
    created_by_api_key_id: text()
      .notNull()
      .references(() => apiKeys.id),
    source_ip: text(),
    user_agent: text(),
    cli_version: text(),
    git_branch: text(),
    git_commit_sha: text(),
    git_commit_subject: text(),
    git_dirty: boolean(),
    original_filename: text(),
    request_id: text(),
    has_inline_script: boolean(),
    external_image_hosts: jsonb().$type<string[]>(),
    ci_run_url: text(),
    ci_actor: text(),
  },
  (table) => [
    unique("draft_versions_draft_id_version_number_key").on(table.draft_id, table.version_number),
    index("draft_versions_draft_id_idx").on(table.draft_id),
  ],
);
export const uploadEvents = pgTable(
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
    metadata_json: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    created_at: time("created_at").notNull().defaultNow(),
  },
  (table) => [index("upload_events_draft_id_idx").on(table.draft_id)],
);
export const identities = pgTable(
  "identities",
  {
    id: text().primaryKey(),
    account_id: text()
      .notNull()
      .references(() => accounts.id),
    provider: text().notNull(),
    subject: text().notNull(),
    email: text(),
    email_verified: boolean(),
    display_name: text(),
    picture_url: text(),
    pii_subject: text(),
    created_at: time("created_at").notNull().defaultNow(),
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
