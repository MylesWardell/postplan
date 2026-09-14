// Row shapes returned by Postgres (snake_case, exactly as selected) and the
// request-scoped auth identity attached by the API key middleware.

export interface ApiKeyAuth {
  id: string;
  account_id: string;
  name: string;
  account_name: string;
}

export interface DraftRow {
  id: string;
  account_id: string;
  title: string;
  description: string | null;
  current_version_id: string | null;
  repo_org: string | null;
  repo_name: string | null;
  repo_host: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  disabled_at: Date | null;
  disabled_reason: string | null;
}

export interface DraftVersionRow {
  id: string;
  draft_id: string;
  version_number: number;
  object_key: string;
  content_hash: string;
  file_size: number;
  created_at: Date;
  created_by_api_key_id: string;
  source_ip: string | null;
  user_agent: string | null;
  cli_version: string | null;
  git_branch: string | null;
  git_commit_sha: string | null;
  git_commit_subject: string | null;
  git_dirty: boolean | null;
  original_filename: string | null;
  request_id: string | null;
  has_inline_script: boolean | null;
  external_image_hosts: string[] | null;
  ci_run_url: string | null;
  ci_actor: string | null;
}

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

export interface ApiKeySummary {
  id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
}

// Decoded HMAC session cookie payload (see web-auth.ts).
export interface Session {
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: ApiKeyAuth;
    }
  }
}
