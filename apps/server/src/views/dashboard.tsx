import type { Session } from "../auth/types.js";
import { Layout, page } from "./layout.js";
import type { AccountDraft } from "@postplan/api";
import { date, Status } from "./shared.js";

export function dashboardResponse(
  session: Session,
  drafts: AccountDraft[],
  query: string,
  status: string,
): Response {
  const filtered = drafts.filter(
    (draft) =>
      (!query ||
        `${draft.title} ${draft.description ?? ""} ${draft.repoName ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (status === "disabled" ? draft.disabled : status === "published" ? !draft.disabled : true),
  );
  return page(
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
          <strong>{drafts.length}</strong>
        </div>
        <div class="stat">
          <span>Published</span>
          <strong>{drafts.filter((draft) => !draft.disabled).length}</strong>
        </div>
        <div class="stat">
          <span>Saved versions</span>
          <strong>{drafts.reduce((sum, draft) => sum + draft.versionCount, 0)}</strong>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>
            Draft library <span class="muted">· {filtered.length}</span>
          </h2>
          <form class="search" method="get" action="/dashboard">
            <input
              type="search"
              name="q"
              aria-label="Search drafts"
              placeholder="Search drafts…"
              value={query}
            />
            <select name="status" aria-label="Publication status" value={status}>
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="disabled">Disabled</option>
            </select>
            <button class="secondary">Filter</button>
          </form>
        </div>
        {filtered.length ? (
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
                {filtered.map((draft) => (
                  <tr key={draft.draftId}>
                    <td>
                      <a class="draft-title" href={`/dashboard/drafts/${draft.draftId}`}>
                        {draft.title}
                      </a>
                      <span class="description">
                        {draft.description || draft.repoName || "No description yet"}
                      </span>
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
                        href={`/dashboard/drafts/${draft.draftId}`}
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
            <h2>{drafts.length ? "No drafts match your filters" : "Your next idea starts here"}</h2>
            <p>
              {drafts.length
                ? "Try another search or clear your filters to see all your drafts."
                : "Connect your CLI, then publish your first HTML file. Every version will find a home here."}
            </p>
            <a class="button secondary" href={drafts.length ? "/dashboard" : "/cli/auth"}>
              {drafts.length ? "Clear filters" : "Set up your CLI"}
            </a>
          </div>
        )}
      </section>
      <div class="hint">
        <span>Upload a new draft from your terminal.</span>
        <code>postplan upload ./plan.html</code>
      </div>
    </Layout>,
  );
}
