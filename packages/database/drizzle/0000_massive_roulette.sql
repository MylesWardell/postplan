-- Compatibility baseline: supports both fresh databases and the previous startup schema.

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      title TEXT NOT NULL,
      description TEXT,
      current_version_id TEXT,
      repo_org TEXT,
      repo_name TEXT,
      repo_host TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      disabled_at TIMESTAMPTZ,
      disabled_reason TEXT
    );
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS draft_versions (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL REFERENCES drafts(id),
      version_number INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by_api_key_id TEXT NOT NULL REFERENCES api_keys(id),
      source_ip TEXT,
      user_agent TEXT,
      cli_version TEXT,
      git_branch TEXT,
      git_commit_sha TEXT,
      git_commit_subject TEXT,
      git_dirty BOOLEAN,
      original_filename TEXT,
      request_id TEXT,
      has_inline_script BOOLEAN,
      external_image_hosts JSONB,
      ci_run_url TEXT,
      ci_actor TEXT,
      UNIQUE (draft_id, version_number)
    );
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS upload_events (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL REFERENCES drafts(id),
      draft_version_id TEXT REFERENCES draft_versions(id),
      api_key_id TEXT NOT NULL REFERENCES api_keys(id),
      event_type TEXT NOT NULL,
      source_ip TEXT,
      user_agent TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      email_verified BOOLEAN,
      display_name TEXT,
      picture_url TEXT,
      pii_subject TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ,
      UNIQUE (provider, subject)
    );
--> statement-breakpoint

    CREATE INDEX IF NOT EXISTS draft_versions_draft_id_idx ON draft_versions(draft_id);
--> statement-breakpoint
    CREATE INDEX IF NOT EXISTS upload_events_draft_id_idx ON upload_events(draft_id);
--> statement-breakpoint
    CREATE INDEX IF NOT EXISTS drafts_account_id_idx ON drafts(account_id);
--> statement-breakpoint

    -- Backfill columns for databases created before they were introduced.
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS email TEXT;
--> statement-breakpoint
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS email_verified BOOLEAN;
--> statement-breakpoint
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS display_name TEXT;
--> statement-breakpoint
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS picture_url TEXT;
--> statement-breakpoint
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS pii_subject TEXT;
--> statement-breakpoint
    ALTER TABLE drafts ADD COLUMN IF NOT EXISTS description TEXT;
--> statement-breakpoint
    ALTER TABLE drafts ADD COLUMN IF NOT EXISTS repo_host TEXT;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS git_commit_subject TEXT;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS git_dirty BOOLEAN;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS request_id TEXT;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS has_inline_script BOOLEAN;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS external_image_hosts JSONB;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS ci_run_url TEXT;
--> statement-breakpoint
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS ci_actor TEXT;
--> statement-breakpoint
