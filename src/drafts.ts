import { pool } from "./db.js";
import { config } from "./config.js";
import { getDraftPublicUrl, getDraftRawUrl } from "./public-url.js";
import type { DraftVersionSummary } from "./types.js";

export interface AccountDraft {
  draftId: string;
  title: string;
  description: string | null;
  repoOrg: string | null;
  repoName: string | null;
  repoHost: string | null;
  latestVersionNumber: number | null;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
  latestVersionAt: Date | null;
  disabled: boolean;
  publicUrl: string;
  rawUrl: string;
}

export interface AccountDraftDetail {
  draft: {
    draftId: string;
    title: string;
    description: string | null;
    publicUrl: string;
  };
  versions: DraftVersionSummary[];
}

interface AccountDraftRow {
  id: string;
  title: string;
  description: string | null;
  repo_org: string | null;
  repo_name: string | null;
  repo_host: string | null;
  created_at: Date;
  updated_at: Date;
  disabled_at: Date | null;
  latest_version_number: number | null;
  latest_version_at: Date | null;
  version_count: number;
}

// The "my docs" feed: every draft owned by an account, newest first, with the
// aggregates a dashboard needs (latest version, version count, repo). Shared
// by GET /api/drafts and the server-rendered dashboard.
export async function listAccountDrafts(
  accountId: string,
  { requestBaseUrl }: { requestBaseUrl: string },
): Promise<AccountDraft[]> {
  const result = await pool.query<AccountDraftRow>(
    `
      SELECT
        d.id,
        d.title,
        d.description,
        d.repo_org,
        d.repo_name,
        d.repo_host,
        d.created_at,
        d.updated_at,
        d.disabled_at,
        cv.version_number AS latest_version_number,
        cv.created_at AS latest_version_at,
        COALESCE(vc.version_count, 0) AS version_count
      FROM drafts d
      LEFT JOIN draft_versions cv ON cv.id = d.current_version_id
      LEFT JOIN (
        SELECT draft_id, COUNT(*)::int AS version_count
        FROM draft_versions
        GROUP BY draft_id
      ) vc ON vc.draft_id = d.id
      WHERE d.account_id = $1
        AND d.deleted_at IS NULL
      ORDER BY d.updated_at DESC
    `,
    [accountId],
  );

  return result.rows.map((row) => ({
    draftId: row.id,
    title: row.title,
    description: row.description,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber:
      row.latest_version_number === null ? null : Number(row.latest_version_number),
    versionCount: Number(row.version_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersionAt: row.latest_version_at,
    disabled: Boolean(row.disabled_at),
    publicUrl: getDraftPublicUrl({
      draftId: row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl,
    }),
    rawUrl: getDraftRawUrl({
      draftId: row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl,
    }),
  }));
}

export async function getAccountDraftWithVersions(
  accountId: string,
  draftId: string,
  { requestBaseUrl }: { requestBaseUrl: string },
): Promise<AccountDraftDetail | null> {
  const draftResult = await pool.query<{ id: string; title: string; description: string | null }>(
    `
      SELECT *
      FROM drafts
      WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
      LIMIT 1
    `,
    [draftId, accountId],
  );
  const draft = draftResult.rows[0];
  if (!draft) return null;

  const versionsResult = await pool.query<DraftVersionSummary>(
    `
      SELECT id, version_number, created_at, git_branch, git_commit_sha,
             git_commit_subject, git_dirty, file_size
      FROM draft_versions
      WHERE draft_id = $1
      ORDER BY version_number DESC
    `,
    [draftId],
  );

  return {
    draft: {
      draftId: draft.id,
      title: draft.title,
      description: draft.description,
      publicUrl: getDraftPublicUrl({
        draftId: draft.id,
        publicBaseUrl: config.publicBaseUrl,
        requestBaseUrl,
      }),
    },
    versions: versionsResult.rows,
  };
}
