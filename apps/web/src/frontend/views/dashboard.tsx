import type { DraftStatus } from "@postplan/api";

import { Layout } from "../layout";
import type { loadDashboard } from "../loaders";
import { date, Status } from "../shared";

function dashboardHref(query: string, status: DraftStatus, cursor?: string) {
  const params = new URLSearchParams();

  if (query) {
    params.set("q", query);
  }

  if (status !== "all") {
    params.set("status", status);
  }

  if (cursor) {
    params.set("cursor", cursor);
  }

  const search = params.toString();

  return search ? `/dashboard?${search}` : "/dashboard";
}

export function DashboardPage({
  session,
  drafts,
  totals,
  nextCursor,
  query,
  status,
  paged,
}: Awaited<ReturnType<typeof loadDashboard>>) {
  return (
    <Layout title="Your drafts" session={session} active="drafts">
      <p class="eyebrow">Workspace</p>
      <div class="heading">
        <div>
          <h1>Your drafts</h1>
          <p class="muted">A little less scattered. All your shared work, in one place.</p>
        </div>
        <a class="button" href="/cli/auth">
          Connect your CLI ↗
        </a>
      </div>
      <div class="stats">
        <div class="stat">
          <span>Total drafts</span>
          <strong>{totals.drafts}</strong>
        </div>
        <div class="stat">
          <span>Published</span>
          <strong>{totals.published}</strong>
        </div>
        <div class="stat">
          <span>Saved versions</span>
          <strong>{totals.versions}</strong>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>
            Draft library{" "}
            <span class="muted">
              · {drafts.length}
              {nextCursor || paged ? " on this page" : ""}
            </span>
          </h2>
          <form class="search" method="get" action="/dashboard">
            <input
              type="search"
              name="q"
              aria-label="Search drafts"
              placeholder="Search drafts…"
              value={query}
            />
            <select name="status" aria-label="Publication status">
              <option value="all" selected={status === "all"}>
                All statuses
              </option>
              <option value="published" selected={status === "published"}>
                Published
              </option>
              <option value="disabled" selected={status === "disabled"}>
                Disabled
              </option>
            </select>
            <button class="secondary">Filter</button>
          </form>
        </div>
        {drafts.length ? (
          <div class="table-scroll">
            <table class="library">
              <thead>
                <tr>
                  <th>Draft</th>
                  <th>Status</th>
                  <th class="hide-small">Versions</th>
                  <th>Updated · UTC</th>
                  <th>
                    <span aria-label="Actions">↗</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.draftId}>
                    <td>
                      <a class="draft-title" href={`/dashboard/drafts/${draft.draftId}/`}>
                        {draft.title}
                      </a>
                      <span class="description">{draft.summary}</span>
                    </td>
                    <td>
                      <Status disabled={draft.disabled} />
                    </td>
                    <td class="hide-small">
                      v{draft.latestVersionNumber ?? 0}
                      <span class="repo"> · {draft.versionCount} saved</span>
                    </td>
                    <td class="nowrap muted">{date(draft.updatedAt)}</td>
                    <td>
                      <a
                        href={`/dashboard/drafts/${draft.draftId}/`}
                        aria-label={`Manage ${draft.title}`}
                      >
                        Manage →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="empty">
            <span class="mark" aria-hidden="true">
              p
            </span>
            <h2>{totals.drafts ? "No drafts match your filters" : "Your next idea starts here"}</h2>
            <p>
              {totals.drafts
                ? "Try another search or clear your filters to see all your drafts."
                : "Connect your CLI, then publish your first HTML file. Every version will find a home here."}
            </p>
            <a class="button secondary" href={totals.drafts ? "/dashboard" : "/cli/auth"}>
              {totals.drafts ? "Clear filters" : "Set up your CLI"}
            </a>
          </div>
        )}
        {paged || nextCursor ? (
          <nav class="pager" aria-label="Draft pages">
            {paged ? <a href={dashboardHref(query, status)}>← First page</a> : <span />}
            {nextCursor ? <a href={dashboardHref(query, status, nextCursor)}>Next page →</a> : null}
          </nav>
        ) : null}
      </section>
      <div class="hint">
        <span>Upload a new draft from your terminal.</span>
        <code>postplan upload ./plan.html</code>
      </div>
    </Layout>
  );
}
