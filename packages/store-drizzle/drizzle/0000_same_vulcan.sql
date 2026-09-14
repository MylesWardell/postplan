CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_key` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `draft_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`object_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`file_size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_api_key_id` text NOT NULL,
	`source_ip` text,
	`user_agent` text,
	`cli_version` text,
	`git_branch` text,
	`git_commit_sha` text,
	`git_commit_subject` text,
	`git_dirty` integer,
	`original_filename` text,
	`request_id` text,
	`has_inline_script` integer,
	`external_image_hosts` text,
	`ci_run_url` text,
	`ci_actor` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `draft_versions_draft_id_idx` ON `draft_versions` (`draft_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_versions_draft_id_version_number_key` ON `draft_versions` (`draft_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`current_version_id` text,
	`repo_org` text,
	`repo_name` text,
	`repo_host` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	`disabled_at` integer,
	`disabled_reason` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `drafts_account_id_idx` ON `drafts` (`account_id`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`email_verified` integer,
	`display_name` text,
	`picture_url` text,
	`pii_subject` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_subject_key` ON `identities` (`provider`,`subject`);--> statement-breakpoint
CREATE TABLE `upload_events` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`draft_version_id` text,
	`api_key_id` text NOT NULL,
	`event_type` text NOT NULL,
	`source_ip` text,
	`user_agent` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_version_id`) REFERENCES `draft_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `upload_events_draft_id_idx` ON `upload_events` (`draft_id`);