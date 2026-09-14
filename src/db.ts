import pg from "pg";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { databasePoolConfig } from "./db-config.js";
import { sha256 } from "./crypto.js";
import { newInternalId } from "./ids.js";
import type { ApiKeyAuth } from "./types.js";

const { Pool } = pg;

export const publicUploadAuth: ApiKeyAuth = {
  id: "key_public_upload",
  account_id: "acct_public_upload",
  name: "Public Uploads",
  account_name: "Public Uploads",
};

// Arbitrary constant key for pg_advisory_lock so that several instances
// starting at once (e.g. an ECS rolling deploy) run the schema DDL serially.
const SCHEMA_LOCK_KEY = 7_406_311_021;

export const pool = new Pool(databasePoolConfig(config));

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    try {
      await applySchema(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  await ensurePublicUploadApiKey();
}

async function applySchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

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

    CREATE INDEX IF NOT EXISTS draft_versions_draft_id_idx ON draft_versions(draft_id);
    CREATE INDEX IF NOT EXISTS upload_events_draft_id_idx ON upload_events(draft_id);
    CREATE INDEX IF NOT EXISTS drafts_account_id_idx ON drafts(account_id);

    -- Backfill columns for databases created before they were introduced.
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS email_verified BOOLEAN;
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS display_name TEXT;
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS picture_url TEXT;
    ALTER TABLE identities ADD COLUMN IF NOT EXISTS pii_subject TEXT;
    ALTER TABLE drafts ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE drafts ADD COLUMN IF NOT EXISTS repo_host TEXT;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS git_commit_subject TEXT;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS git_dirty BOOLEAN;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS request_id TEXT;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS has_inline_script BOOLEAN;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS external_image_hosts JSONB;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS ci_run_url TEXT;
    ALTER TABLE draft_versions ADD COLUMN IF NOT EXISTS ci_actor TEXT;
  `);
}

export async function ensureBootstrapApiKey(): Promise<void> {
  if (!config.bootstrapApiKey) return;

  const accountId = "acct_bootstrap";
  const apiKeyId = "key_bootstrap";
  const keyHash = sha256(config.bootstrapApiKey);

  await pool.query(
    `
      INSERT INTO accounts (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET updated_at = now()
    `,
    [accountId, "Bootstrap Account"],
  );

  await pool.query(
    `
      INSERT INTO api_keys (id, account_id, name, key_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
        SET key_hash = EXCLUDED.key_hash,
            name = EXCLUDED.name,
            revoked_at = NULL
    `,
    [apiKeyId, accountId, "Bootstrap API Key", keyHash],
  );
}

export async function findApiKeyByToken(token: string): Promise<ApiKeyAuth | null> {
  const keyHash = sha256(token);
  const result = await pool.query<ApiKeyAuth>(
    `
      SELECT api_keys.id, api_keys.account_id, api_keys.name, accounts.name AS account_name
      FROM api_keys
      JOIN accounts ON accounts.id = api_keys.account_id
      WHERE api_keys.key_hash = $1
        AND api_keys.id <> $2
        AND api_keys.revoked_at IS NULL
      LIMIT 1
    `,
    [keyHash, publicUploadAuth.id],
  );

  const apiKey = result.rows[0] ?? null;
  if (apiKey) {
    await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [apiKey.id]);
  }
  return apiKey;
}

async function ensurePublicUploadApiKey(): Promise<void> {
  await pool.query(
    `
      INSERT INTO accounts (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            updated_at = now()
    `,
    [publicUploadAuth.account_id, publicUploadAuth.account_name],
  );

  await pool.query(
    `
      INSERT INTO api_keys (id, account_id, name, key_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
        SET key_hash = EXCLUDED.key_hash,
            name = EXCLUDED.name,
            revoked_at = NULL
    `,
    [
      publicUploadAuth.id,
      publicUploadAuth.account_id,
      publicUploadAuth.name,
      sha256("postplan-public-upload-sentinel"),
    ],
  );
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function newEventId(): string {
  return newInternalId();
}

export interface IdentityProfile {
  email?: string | null;
  emailVerified?: boolean | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  piiSubject?: string | null;
}

export interface IdentityAccount {
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
}

interface IdentityInput {
  provider: string;
  subject: string;
  profile?: IdentityProfile;
}

// Maps a verified external identity (e.g. shoo's pairwise_sub) to a postplan
// account, creating both on first sign-in. Profile claims (from shoo's pii
// consent) are refreshed on every login — they can change at Google any time.
export async function findOrCreateAccountForIdentity({
  provider,
  subject,
  profile = {},
}: IdentityInput): Promise<IdentityAccount> {
  try {
    return await upsertIdentity({ provider, subject, profile });
  } catch (error) {
    // Two concurrent first sign-ins (e.g. two devices) can both miss the
    // SELECT and collide on UNIQUE(provider, subject). The loser's transaction
    // rolled back entirely (including its orphan account), so one retry hits
    // the existing-identity path and succeeds.
    if (isPgError(error) && error.code === "23505") {
      return upsertIdentity({ provider, subject, profile });
    }
    throw error;
  }
}

async function upsertIdentity({
  provider,
  subject,
  profile,
}: Required<IdentityInput>): Promise<IdentityAccount> {
  const profileParams = [
    profile.email ?? null,
    profile.emailVerified ?? null,
    profile.displayName ?? null,
    profile.pictureUrl ?? null,
    profile.piiSubject ?? null,
  ];

  return withTransaction(async (client) => {
    const existing = await client.query<{ account_id: string; account_name: string }>(
      `
        SELECT identities.account_id, accounts.name AS account_name
        FROM identities
        JOIN accounts ON accounts.id = identities.account_id
        WHERE identities.provider = $1 AND identities.subject = $2
        LIMIT 1
      `,
      [provider, subject],
    );

    const existingRow = existing.rows[0];
    if (existingRow) {
      const accountId = existingRow.account_id;
      // The verified token is authoritative for profile fields: a claim absent
      // from this login (e.g. the user removed their Google picture) clears the
      // stored value, so DB, session, and header always agree. pii_subject is
      // the one exception — it is a stable identifier, not editable profile,
      // and a transient absence must not unlink the account.
      await client.query(
        `
          UPDATE identities
          SET last_login_at = now(),
              email = $3,
              email_verified = $4,
              display_name = $5,
              picture_url = $6,
              pii_subject = COALESCE($7, pii_subject)
          WHERE provider = $1 AND subject = $2
        `,
        [provider, subject, ...profileParams],
      );

      // Same authoritative-token rule for the derived account name: if the
      // user clears their Google name/email, the account label degrades to the
      // neutral fallback instead of retaining old PII.
      const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
      if (accountName !== existingRow.account_name) {
        await client.query("UPDATE accounts SET name = $2, updated_at = now() WHERE id = $1", [
          accountId,
          accountName,
        ]);
      }
      return {
        accountId,
        accountName,
        email: profile.email ?? null,
        pictureUrl: profile.pictureUrl ?? null,
      };
    }

    const accountId = `acct_${newInternalId()}`;
    const accountName = profile.displayName || profile.email || `Postplan ${subject.slice(-6)}`;
    await client.query("INSERT INTO accounts (id, name) VALUES ($1, $2)", [accountId, accountName]);
    await client.query(
      `
        INSERT INTO identities (
          id, account_id, provider, subject,
          email, email_verified, display_name, picture_url, pii_subject,
          last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      `,
      [newInternalId(), accountId, provider, subject, ...profileParams],
    );
    return {
      accountId,
      accountName,
      email: profile.email ?? null,
      pictureUrl: profile.pictureUrl ?? null,
    };
  });
}

function isPgError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
